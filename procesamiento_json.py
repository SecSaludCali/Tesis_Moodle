import pandas as pd
import numpy as np
import json
import os
import logging
import re
import glob  # <-- NUEVO IMPORT NECESARIO

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class MotorAnalitico:
    def __init__(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.ruta_moodle = os.path.join(self.base_dir, 'kpis_moodle_agregados.csv')
        self.ruta_sat = os.path.join(self.base_dir, 'fact_satisfaccion.csv')
        self.ruta_perf = os.path.join(self.base_dir, 'dim_perfiles.csv')
        self.ruta_catalogo = os.path.join(self.base_dir, 'catalogo_cursos.csv')
        self.carpeta_moodle = os.path.join(self.base_dir, 'descargas_moodle') # <-- NUEVA RUTA PARA LEER CORREOS

    def ejecutar(self):
        logging.info("Iniciando Motor Analítico (Arquitectura Híbrida: Tiempo Adaptativo + Enlace Relacional)...")

        # 1. Carga de datos
        try:
            df_moodle = pd.read_csv(self.ruta_moodle)
            df_sat_raw = pd.read_csv(self.ruta_sat)
            df_perf_raw = pd.read_csv(self.ruta_perf)
            df_catalogo = pd.read_csv(self.ruta_catalogo)
        except Exception as e:
            logging.error(f"Error al cargar archivos: {e}")
            return

        diccionario_nombres = dict(zip(df_catalogo['ID_Moodle'], df_catalogo['Nombre_Moodle_Extraido']))
        df_moodle['Nombre_Curso'] = df_moodle['ID_Moodle_Original'].map(diccionario_nombres).fillna(df_moodle['Nombre_Curso'])

        moodle_ids = df_moodle['ID_Moodle_Original'].dropna().unique().tolist()
        moodle_ids_lower = [str(mid).lower().strip() for mid in moodle_ids]

        # Asegurar columna de fechas solo en el archivo que la posee
        col_fecha = next((c for c in df_sat_raw.columns if 'marca temporal' in c.lower() or 'timestamp' in c.lower() or 'fecha' in c.lower()), None)
        if col_fecha:
            df_sat_raw[col_fecha] = pd.to_datetime(df_sat_raw[col_fecha], errors='coerce')

        # ========================================================
        # 2. ALGORITMO DE DISTANCIA MÁXIMA EN FORMS (SATISFACCIÓN)
        # ========================================================
        def resolver_tiempo_y_clonacion(df_crudo):
            filas_procesadas = []
            
            for nombre_form, grupo in df_crudo.groupby('Nombre_Curso'):
                nombre_str = str(nombre_form).lower()
                
                # Extraer bloques temporales desde los paréntesis
                bloques_parentesis = re.findall(r'\(([^)]+)\)', nombre_str)
                cohortes_temporales = []
                for bloque in bloques_parentesis:
                    sub_partes = [p.strip() for p in re.split(r'[\s,;]+', bloque) if p.strip()]
                    ids_validos = []
                    for parte in sub_partes:
                        if parte in moodle_ids_lower:
                            idx = moodle_ids_lower.index(parte)
                            ids_validos.append(moodle_ids[idx])
                    if ids_validos:
                        cohortes_temporales.append(list(set(ids_validos)))
                
                num_bloques = len(cohortes_temporales)
                if num_bloques == 0: continue
                
                # Caso A: Un solo bloque temporal (Puede tener 1 o más IDs simultáneos)
                if num_bloques == 1:
                    for mid in cohortes_temporales[0]:
                        g_copy = grupo.copy()
                        g_copy['Llave_PK'] = mid
                        filas_procesadas.append(g_copy)
                    continue
                
                # Caso B: Múltiples Bloques (Análisis de Ruptura Temporal vs Paralelismo)
                # Evaluamos si las encuestas se comportan como cursos paralelos en el mismo bloque de tiempo
                es_paralelo = False
                if "012026" in nombre_str or "01_2026" in nombre_str: 
                    es_paralelo = True

                if es_paralelo:
                    for bloque in cohortes_temporales:
                        for mid in bloque:
                            g_copy = grupo.copy()
                            g_copy['Llave_PK'] = mid
                            filas_procesadas.append(g_copy)
                    continue

                if not col_fecha:
                    partes_df = np.array_split(grupo, num_bloques)
                    for i, segmento in enumerate(partes_df):
                        for mid in cohortes_temporales[i]:
                            seg_c = segmento.copy()
                            seg_c['Llave_PK'] = mid
                            filas_procesadas.append(seg_c)
                    continue
                
                grupo = grupo.sort_values(by=col_fecha).copy()
                grupo['Diferencia'] = grupo[col_fecha].diff().dt.total_seconds()
                
                n_cuts = num_bloques - 1
                largest_gaps = grupo['Diferencia'].nlargest(n_cuts).index
                cortes_internos = sorted([grupo.index.get_loc(idx) for idx in largest_gaps])
                cortes = [0] + cortes_internos + [len(grupo)]
                
                for i in range(num_bloques):
                    start = cortes[i]
                    end = cortes[i+1]
                    segmento = grupo.iloc[start:end].copy()
                    if not segmento.empty:
                        segmento = segmento.drop(columns=['Diferencia'], errors='ignore')
                        for mid in cohortes_temporales[i]:
                            seg_c = segmento.copy()
                            seg_c['Llave_PK'] = mid
                            filas_procesadas.append(seg_c)
                            
            if filas_procesadas:
                return pd.concat(filas_procesadas, ignore_index=True)
            return pd.DataFrame(columns=df_crudo.columns.tolist() + ['Llave_PK'])

        df_sat = resolver_tiempo_y_clonacion(df_sat_raw)

        # ========================================================
        # 3. CRUCE RELACIONAL DE DEMOGRAFÍA (GARANTIZA INTEGRIDAD)
        # ========================================================
        if not df_sat.empty and 'ID_Formulario' in df_sat.columns and 'ID_Formulario' in df_perf_raw.columns:
            mapa_llaves = df_sat[['ID_Formulario', 'Llave_PK']].drop_duplicates()
            df_perf_limpio = df_perf_raw.drop(columns=['Llave_PK', 'Llaves_List'], errors='ignore')
            df_perf = pd.merge(df_perf_limpio, mapa_llaves, on='ID_Formulario', how='inner')
        else:
            df_perf = df_perf_raw.copy()
            df_perf['Llave_PK'] = None
            logging.error("No se pudo cruzar la demografía: falta columna ID_Formulario.")

        # Limpiar registros nulos
        df_sat = df_sat[df_sat['Llave_PK'].notna()]
        df_perf = df_perf[df_perf['Llave_PK'].notna()]

        df_moodle['Llave_PK'] = df_moodle['ID_Moodle_Original']
        df_moodle = df_moodle.drop_duplicates(subset=['Llave_PK'])

        # 4. Ingeniería de Características en Satisfacción
        cols_preguntas = [c for c in df_sat.columns if '¿' in c]
        for c in cols_preguntas:
            df_sat[c] = df_sat[c].astype(str).str.strip().str.lower()
            df_sat[c] = df_sat[c].replace({'sí': 5, 'si': 5, 'no': 1})
            df_sat[c] = pd.to_numeric(df_sat[c], errors='coerce')

        col_dominio = next((c for c in cols_preguntas if 'dominio' in c.lower()), cols_preguntas[0])
        col_metodo = next((c for c in cols_preguntas if 'metodología' in c.lower()), cols_preguntas[0])
        col_inquietudes = next((c for c in cols_preguntas if 'inquietudes' in c.lower()), cols_preguntas[0])
        col_nuevos = next((c for c in cols_preguntas if 'nuevos conceptos' in c.lower()), cols_preguntas[0])
        col_practica = next((c for c in cols_preguntas if 'práctica' in c.lower()), cols_preguntas[0])
        col_espacio = next((c for c in cols_preguntas if 'espacio físico' in c.lower() or 'virtual' in c.lower()), cols_preguntas[0])
        col_material = next((c for c in cols_preguntas if 'material' in c.lower()), cols_preguntas[0])
        col_obj_conocer = next((c for c in cols_preguntas if 'dio a conocer' in c.lower()), cols_preguntas[0])
        col_obj_cumplio = next((c for c in cols_preguntas if 'cumplió' in c.lower()), cols_preguntas[0])
        col_general = next((c for c in cols_preguntas if 'en general' in c.lower()), cols_preguntas[-1])

        df_sat['ICD'] = df_sat[[col_dominio, col_metodo, col_inquietudes]].mean(axis=1)
        df_sat['IUP'] = df_sat[[col_nuevos, col_practica]].mean(axis=1)
        df_sat['Score_UX'] = df_sat[[col_espacio, col_material]].mean(axis=1)
        df_sat['Brecha_Expectativa'] = df_sat[col_obj_cumplio] - df_sat[col_obj_conocer]
        df_sat['ISG'] = df_sat[cols_preguntas].mean(axis=1)

        def clasificar_nps(val):
            if pd.isna(val): return None
            if val == 5: return 'Promotor'
            if val == 4: return 'Pasivo'
            return 'Detractor'
        df_sat['Categoria_NPS'] = df_sat[col_general].apply(clasificar_nps)

        def calcular_nps_curso(x):
            total = len(x.dropna())
            if total == 0: return 0
            promotores = (x == 'Promotor').sum() / total
            detractores = (x == 'Detractor').sum() / total
            return round((promotores - detractores) * 100, 1)

        agg_funcs = {
            'Total_Encuestas': ('Llave_PK', 'count'),
            'ISG_Promedio': ('ISG', 'mean'),
            'ICD_Promedio': ('ICD', 'mean'),
            'IUP_Promedio': ('IUP', 'mean'),
            'UX_Promedio': ('Score_UX', 'mean'),
            'Brecha_Expectativa': ('Brecha_Expectativa', 'mean'),
            'e_NPS': ('Categoria_NPS', calcular_nps_curso)
        }
        for q in cols_preguntas:
            agg_funcs[q] = (q, 'mean')

        sat_agrupada = df_sat.groupby('Llave_PK').agg(**agg_funcs).reset_index()

        for col in ['ISG_Promedio', 'ICD_Promedio', 'IUP_Promedio', 'UX_Promedio', 'Brecha_Expectativa'] + cols_preguntas:
            sat_agrupada[col] = sat_agrupada[col].round(2)

        # 5. Cruce Left Join Estricto (Moodle Manda)
        df_final = pd.merge(df_moodle, sat_agrupada, on='Llave_PK', how='left')

        cols_numericas = df_final.select_dtypes(include=[np.number]).columns
        df_final[cols_numericas] = df_final[cols_numericas].fillna(0)
        df_final = df_final.replace({np.nan: None}) 

        def calcular_chs(row):
            score_isg = (row['ISG_Promedio'] / 5) * 100
            score_iup = (row['IUP_Promedio'] / 5) * 100
            score_ux = (row['UX_Promedio'] / 5) * 100
            tasa_fin = row['Tasa_Finalizacion_%']
            if row['Total_Encuestas'] > 0:
                chs = (tasa_fin * 0.4) + (score_isg * 0.3) + (score_iup * 0.2) + (score_ux * 0.1)
            else:
                chs = tasa_fin
            return round(chs, 1)

        df_final['Salud_Curso_CHS'] = df_final.apply(calcular_chs, axis=1)

        # 6. Agrupaciones Demográficas Finales
        demo_genero = df_perf.groupby(['Llave_PK', 'Sexo']).size().unstack(fill_value=0).to_dict(orient='index')
        demo_perfil = df_perf.groupby(['Llave_PK', 'Perfil']).size().unstack(fill_value=0).to_dict(orient='index')
        demo_edad = df_perf.groupby(['Llave_PK', 'Curso de vida']).size().unstack(fill_value=0).to_dict(orient='index')
        demo_comuna = df_perf.groupby(['Llave_PK', 'Comuna_Unificada']).size().unstack(fill_value=0).to_dict(orient='index')
        demo_escolaridad = df_perf.groupby(['Llave_PK', 'Escolaridad']).size().unstack(fill_value=0).to_dict(orient='index') if 'Escolaridad' in df_perf.columns else {}

        # Mantiene la suma exacta de las 3834 encuestas originales para las gráficas
        demografia_global = {
            "Sexo": df_perf_raw['Sexo'].value_counts().to_dict(),
            "Perfil": df_perf_raw['Perfil'].value_counts().to_dict(),
            "Curso de Vida": df_perf_raw['Curso de vida'].value_counts().to_dict(),
            "Comuna": df_perf_raw['Comuna_Unificada'].value_counts().to_dict(),
            "Escolaridad": df_perf_raw['Escolaridad'].value_counts().to_dict() if 'Escolaridad' in df_perf_raw.columns else {}
        }

        # ========================================================
        # NUEVO: CÁLCULO DE ESTUDIANTES ÚNICOS (MÉTRICA GLOBAL)
        # ========================================================
        estudiantes_unicos = set()
        if os.path.exists(self.carpeta_moodle):
            for file_path in glob.glob(os.path.join(self.carpeta_moodle, '*.csv')):
                try:
                    df_raw = pd.read_csv(file_path, sep=',')
                    if len(df_raw.columns) < 3: df_raw = pd.read_csv(file_path, sep=';')
                    
                    # Buscar la columna de correo
                    col_correo = next((col for col in df_raw.columns if 'correo' in str(col).lower() or 'email' in str(col).lower()), df_raw.columns[1] if len(df_raw.columns) > 1 else None)
                    
                    if col_correo:
                        # Limpiar correos y agregar al Set (que elimina duplicados solo)
                        correos_limpios = df_raw[col_correo].dropna().astype(str).str.strip().str.lower().tolist()
                        estudiantes_unicos.update(correos_limpios)
                except Exception as e:
                    logging.warning(f"No se pudo extraer correos de {file_path}: {e}")
        
        total_estudiantes_unicos = len(estudiantes_unicos)
        logging.info(f"✔ Estudiantes ÚNICOS identificados en la plataforma Moodle: {total_estudiantes_unicos}")
        # ========================================================

        # 7. Construcción de Estructura JSON
        cursos_lista = df_final.to_dict(orient='records')
        for c in cursos_lista:
            llave = c['Llave_PK']
            nombre_oficial = str(c['Nombre_Curso']).strip()
            partes = nombre_oficial.split(' - ')
            
            if len(partes) >= 3:
                c['Curso_Base'] = partes[0].strip()
                anio = partes[1].strip()
                num_c = int(partes[2].strip()) if partes[2].strip().isdigit() else partes[2].strip()
                c['Edicion'] = f"{anio} - Cohorte {num_c}"
            elif len(partes) == 2:
                c['Curso_Base'] = partes[0].strip()
                c['Edicion'] = f"{partes[1].strip()} - Única"
            else:
                c['Curso_Base'] = nombre_oficial
                c['Edicion'] = "General - Única"
            
            c['Demografia'] = {
                'Sexo': demo_genero.get(llave, {}),
                'Perfil': demo_perfil.get(llave, {}),
                'Edad': demo_edad.get(llave, {}),
                'Comuna': demo_comuna.get(llave, {}),
                'Escolaridad': demo_escolaridad.get(llave, {})
            }
            c['Detalle_Preguntas'] = { q: c.get(q, 0) for q in cols_preguntas }
            for q in cols_preguntas: c.pop(q, None)
            c.pop('Llave_PK', None)

        dashboard_json = {
            "metadata": {
                "total_cursos_analizados": len(cursos_lista),
                "total_encuestas_historicas": len(df_sat_raw),
                "total_estudiantes_unicos": total_estudiantes_unicos # <-- INYECCIÓN DE LA MÉTRICA
            },
            "kpis_globales": {
                "chs_promedio_secretaria": round(df_final['Salud_Curso_CHS'].mean(), 1) if len(df_final) > 0 else 0,
                "nps_global": round(df_final[df_final['Total_Encuestas'] > 0]['e_NPS'].mean(), 1) if len(df_final) > 0 else 0
            },
            "demografia_global": demografia_global,
            "cursos": cursos_lista
        }

        ruta_salida = os.path.join(self.base_dir, 'dashboard_data.json')
        with open(ruta_salida, 'w', encoding='utf-8') as f:
            json.dump(dashboard_json, f, ensure_ascii=False, indent=4)

        logging.info(f"--- MAPEO RELACIONAL FINALIZADO ---")

if __name__ == "__main__":
    motor = MotorAnalitico()
    motor.ejecutar()
