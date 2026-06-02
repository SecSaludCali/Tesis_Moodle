import os
import glob
import pandas as pd
import numpy as np
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class PipelineAnalitico:
    def __init__(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.carpeta_moodle = os.path.join(self.base_dir, 'descargas_moodle')
        self.ruta_forms_crudo = os.path.join(self.base_dir, 'demografia_consolidada.csv')
        self.ruta_catalogo = os.path.join(self.base_dir, 'catalogo_cursos.csv')
        self.nombres_forms_unicos = []

    def procesar_forms(self):
        """Limpia Forms para su posterior cruce en la etapa JSON."""
        logging.info("--- INICIANDO PROCESAMIENTO DE GOOGLE FORMS ---")
        if not os.path.exists(self.ruta_forms_crudo):
            logging.warning("No se encontró demografia_consolidada.csv.")
            return

        df = pd.read_csv(self.ruta_forms_crudo, encoding='utf-8')
        df['Nombre_Curso'] = df['Nombre_Curso'].str.replace(r'^-?\s*Satisfacción del Curso virtual\s*-\s*', '', regex=True).str.strip()
        
        self.nombres_forms_unicos = df['Nombre_Curso'].dropna().unique().tolist()

        col_c1 = 'Comuna o corregimiento de residencia (Si no es de Cali, seleccionar la opción N/A)'
        col_c2 = 'Comuna o corregimiento de residencia'
        if col_c1 in df.columns and col_c2 in df.columns: df['Comuna_Unificada'] = df[col_c1].fillna(df[col_c2])
        elif col_c1 in df.columns: df['Comuna_Unificada'] = df[col_c1]
        elif col_c2 in df.columns: df['Comuna_Unificada'] = df[col_c2]
        else: df['Comuna_Unificada'] = 'N/A'

        cols_base = ['ID_Formulario', 'Nombre_Curso']
        cols_demo = [c for c in ['Sexo', 'Curso de vida', 'Escolaridad', 'Perfil', 'Comuna_Unificada', 'ESE'] if c in df.columns]
        cols_sat = [c for c in df.columns if c.startswith('¿') or c.startswith('En general')]

        df[cols_base + cols_demo].to_csv(os.path.join(self.base_dir, 'dim_perfiles.csv'), index=False, encoding='utf-8-sig')
        df[cols_base + cols_sat].to_csv(os.path.join(self.base_dir, 'fact_satisfaccion.csv'), index=False, encoding='utf-8-sig')
        logging.info("Forms procesado. Creadas tablas de hechos y dimensiones.")

    def obtener_nombres_oficiales(self):
        """Lee el catálogo y crea un diccionario estricto: ID -> Nombre_Moodle_Extraido"""
        if not os.path.exists(self.ruta_catalogo):
            logging.warning("El catálogo aún no existe.")
            return {}

        df_cat = pd.read_csv(self.ruta_catalogo, encoding='utf-8-sig')
        # Mapear el ID de Moodle exclusivamente a su Nombre Oficial Limpio, ignorando la columna de Forms
        dict_nombres_moodle = dict(zip(df_cat['ID_Moodle'], df_cat['Nombre_Moodle_Extraido']))
        return dict_nombres_moodle

    def procesar_moodle(self, dict_nombres_moodle):
        """Procesa CSVs de Moodle y les asigna su nombre oficial perfecto del catálogo."""
        logging.info("--- INICIANDO PROCESAMIENTO DE MOODLE ---")
        csv_files = glob.glob(os.path.join(self.carpeta_moodle, '*.csv'))
        kpis_cursos = []

        for file_path in csv_files:
            id_moodle = os.path.basename(file_path).replace('progress.', '').replace('.csv', '').lower()
            
            # Aquí está la magia: Usamos el ID para jalar el nombre hermoso del catálogo
            nombre_oficial = dict_nombres_moodle.get(id_moodle, id_moodle)

            try:
                df = pd.read_csv(file_path, sep=',')
                if len(df.columns) < 3: df = pd.read_csv(file_path, sep=';')
            except: continue
                
            df.columns = [str(c).strip() for c in df.columns]
            col_nombre = df.columns[0]
            col_correo = next((col for col in df.columns if 'correo' in col.lower() or 'email' in col.lower()), df.columns[1])
            cols_ignorar = [col_nombre, col_correo, 'ID number', 'Institution', 'Department', 'Email address']
            cols_modulos = [c for c in df.columns if c not in cols_ignorar and not c.startswith('Unnamed')]
            cols_todas = [c for c in df.columns if c not in cols_ignorar]

            total_modulos = len(cols_modulos)
            if total_modulos == 0: continue

            completados_lista = []
            para_tiempos = []

            for index, row in df.iterrows():
                completados = 0
                fechas = []
                for col in cols_todas:
                    val = str(row[col]).strip()
                    if val.lower() in ['finalizado', 'completado', 'sí'] or 'aprobado' in val.lower():
                        completados += 1
                    elif len(val) == 19 and val.count('-') == 2 and val.count(':') == 2:
                        fechas.append(pd.to_datetime(val, errors='coerce'))
                
                fechas = [f for f in fechas if pd.notna(f)]
                completados_lista.append(completados)
                if fechas: para_tiempos.append((min(fechas), max(fechas)))

            df['Progreso'] = [c / total_modulos for c in completados_lista]
            inscritos = len(df)
            graduados = len(df[df['Progreso'] >= 0.90]) 
            activos_incompletos = len(df[(df['Progreso'] > 0) & (df['Progreso'] < 0.90)])
            inactivos = len(df[df['Progreso'] == 0])
            
            duraciones_dias = [(max_f - min_f).total_seconds() / 86400 for min_f, max_f in para_tiempos if min_f != max_f]
            tiempo_promedio = np.mean(duraciones_dias) if duraciones_dias else 0

            kpis_cursos.append({
                'Nombre_Curso': nombre_oficial, # Nombre limpio!
                'ID_Moodle_Original': id_moodle, # ID en minúsculas para cruzar con Forms
                'Total_Inscritos': inscritos,
                'Tasa_Finalizacion_%': round((graduados / inscritos * 100), 1) if inscritos else 0,
                'Tasa_Abandono_%': round((activos_incompletos / inscritos * 100), 1) if inscritos else 0,
                'Tasa_Inactividad_%': round((inactivos / inscritos * 100), 1) if inscritos else 0,
                'Tiempo_Promedio_Dias': round(tiempo_promedio, 1)
            })

        pd.DataFrame(kpis_cursos).to_csv(os.path.join(self.base_dir, 'kpis_moodle_agregados.csv'), index=False, encoding='utf-8-sig')
        logging.info("Moodle procesado y unificado con nombres oficiales del catálogo.")

    def ejecutar_todo(self):
        logging.info("=== INICIANDO PIPELINE MAESTRO 100% AUTOMATIZADO ===")
        self.procesar_forms()
        dict_nombres_moodle = self.obtener_nombres_oficiales()
        self.procesar_moodle(dict_nombres_moodle)
        logging.info("=== PIPELINE FINALIZADO. DATOS PURIFICADOS Y LISTOS PARA EL JSON ===")

if __name__ == "__main__":
    pipeline = PipelineAnalitico()
    pipeline.ejecutar_todo()
