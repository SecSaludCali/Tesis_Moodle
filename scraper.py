import os
import glob
import time
import re
import logging
import pandas as pd
from urllib.parse import unquote
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options # Añadido para opciones explícitas
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager

# Configuración de registro (Logging)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

class MoodleDataExtractor:
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.login_url = 'https://moodle.cali.gov.co/login/index.php'
        self.courses_url = 'https://moodle.cali.gov.co/my/courses.php'
        self.report_base_url = 'https://moodle.cali.gov.co/report/progress/index.php?course='
        
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.download_dir = os.path.join(self.base_dir, "descargas_moodle")
        self._prepare_environment()
        self.driver = self._initialize_driver()
        self.wait = WebDriverWait(self.driver, 15)

    def _prepare_environment(self):
        # 1. Crea la carpeta si no existe
        if not os.path.exists(self.download_dir):
            os.makedirs(self.download_dir)
            logging.info(f"Directorio de descargas creado en: {self.download_dir}")
        else:
            # 2. Si ya existe, BORRA todos los CSV viejos para evitar duplicados como archivo(1).csv
            archivos_viejos = glob.glob(os.path.join(self.download_dir, '*.csv'))
            for archivo in archivos_viejos:
                try:
                    os.remove(archivo)
                except Exception as e:
                    logging.warning(f"No se pudo borrar {archivo}: {e}")
            logging.info("Directorio de descargas limpiado exitosamente para la extracción de hoy.")

    def _initialize_driver(self):
        """Inicializa el WebDriver de Chrome con opciones optimizadas para servidores."""
        options = Options()
        
        # Opciones CRÍTICAS para ejecución en la nube (GitHub Actions / Servidores Linux)
        options.add_argument('--headless') # Ejecución sin interfaz gráfica
        options.add_argument('--no-sandbox') # Evita errores de permisos en contenedores
        options.add_argument('--disable-dev-shm-usage') # Evita problemas de memoria compartida
        options.add_argument('--window-size=1920,1080')
        
        prefs = {
            "download.default_directory": self.download_dir,
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "safebrowsing.enabled": True
        }
        options.add_experimental_option("prefs", prefs)
        
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        return driver

    def authenticate(self):
        """Maneja el inicio de sesión, incluyendo la doble validación requerida por Moodle."""
        logging.info("Iniciando proceso de autenticación.")
        try:
            self.driver.get(self.login_url)
            time.sleep(2)
            
            self._submit_credentials()
            time.sleep(3)
            
            # Verificación de doble inicio de sesión
            if 'login' in self.driver.current_url:
                logging.warning("Moodle ha solicitado redirección o doble autenticación. Reintentando...")
                self._submit_credentials()
                time.sleep(3)
                
            if 'login' in self.driver.current_url:
                logging.error("Fallo de autenticación tras dos intentos. Verifique credenciales.")
                raise Exception("Autenticación denegada por Moodle.")
            else:
                logging.info("Autenticación completada exitosamente.")
                
        except Exception as e:
            # Novedad: Tomar captura de pantalla si algo falla
            screenshot_path = os.path.join(self.base_dir, "error_login_moodle.png")
            self.driver.save_screenshot(screenshot_path)
            logging.error(f"Fallo crítico en la página de login. Captura guardada en: {screenshot_path}")
            raise e # Volvemos a lanzar el error para que GitHub sepa que falló

    def _submit_credentials(self):
        """Inyecta las credenciales en el DOM y envía el formulario."""
        username_element = self.wait.until(EC.presence_of_element_located((By.ID, 'username')))
        username_element.clear()
        username_element.send_keys(self.username)
        
        password_element = self.driver.find_element(By.ID, 'password')
        password_element.clear()
        password_element.send_keys(self.password + Keys.RETURN)

    def scan_courses(self):
        """Escanea el DOM de la vista general utilizando esperas explícitas y scroll iterativo."""
        logging.info("Extrayendo identificadores de cursos disponibles...")
        self.driver.get(self.courses_url)
        
        try:
            xpath_query = "//a[contains(@href, 'course') and contains(@href, 'id=')]"
            self.wait.until(EC.presence_of_element_located((By.XPATH, xpath_query)))
        except Exception:
            logging.warning("Latencia detectada. Extendiendo tiempo de espera...")
            time.sleep(5)

        last_height = self.driver.execute_script("return document.body.scrollHeight")
        for _ in range(4):
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)
            new_height = self.driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height

        anchor_elements = self.driver.find_elements(By.TAG_NAME, 'a')
        course_ids = set() 
        
        for element in anchor_elements:
            href = element.get_attribute('href')
            if href and 'course' in href and 'id=' in href:
                match = re.search(r'id=(\d+)', href)
                if match:
                    course_ids.add(match.group(1))

        logging.info(f"Escaneo finalizado. {len(course_ids)} cursos detectados.")
        return list(course_ids)

    def download_reports(self, course_ids):
        """Descarga CSVs y auto-genera el catálogo capturando los nombres de los cursos."""
        if not course_ids:
            logging.warning("La lista de cursos está vacía. Abortando descarga.")
            return

        total_courses = len(course_ids)
        nuevos_registros_catalogo = []

        for index, course_id in enumerate(course_ids, start=1):
            logging.info(f"Procesando curso {course_id} ({index}/{total_courses})")
            
            if 'login' in self.driver.current_url:
                logging.info("Sesión caducada detectada. Restaurando conexión...")
                self.authenticate()
                
            self.driver.get(f"{self.report_base_url}{course_id}")
            
            try:
                self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, 'generaltable')))
                time.sleep(1)
                
                # 1. CAPTURAR EL NOMBRE REAL DE MOODLE Y LA URL
                try:
                    nombre_moodle = self.driver.find_element(By.TAG_NAME, 'h1').text
                except:
                    nombre_moodle = self.driver.title

                url_moodle = self.driver.current_url
                
                # 2. IDENTIFICAR QUÉ ARCHIVO ES EL QUE SE DESCARGA
                archivos_antes = set(glob.glob(os.path.join(self.download_dir, '*.csv')))
                
                export_url = f"{self.report_base_url}{course_id}&dataformat=csv"
                self.driver.get(export_url)
                
                # Esperar hasta 15 segundos a que aparezca el nuevo archivo descargado
                timeout = 15
                archivo_descargado = None
                while timeout > 0:
                    time.sleep(1)
                    archivos_despues = set(glob.glob(os.path.join(self.download_dir, '*.csv')))
                    nuevos = archivos_despues - archivos_antes
                    # Ignorar descargas en curso (.crdownload)
                    nuevos_csv = [f for f in nuevos if not f.endswith('.crdownload')]
                    if nuevos_csv:
                        archivo_descargado = nuevos_csv[0]
                        break
                    timeout -= 1

                if archivo_descargado:
                    nombre_base = os.path.basename(archivo_descargado)
                    # Extraer "aisppmscvi_02_2026" de "progress.aisppmscvi_02_2026.csv"
                    id_moodle_limpio = nombre_base.replace('progress.', '').replace('.csv', '')
                    
                    nuevos_registros_catalogo.append({
                        'ID_Moodle': id_moodle_limpio,
                        'Nombre_Moodle_Extraido': nombre_moodle,
                        'URL_Moodle': url_moodle,
                        'Nombre_Oficial_Forms': nombre_moodle # Se pre-llena para fácil edición
                    })
                    logging.info(f"✔ Descargado y catalogado: {id_moodle_limpio} -> {nombre_moodle}")
                else:
                    logging.warning(f"Timeout al descargar curso {course_id}")
                    
            except Exception as e:
                logging.info(f"Omitiendo curso {course_id} (Data Table no encontrada). Error: {e}")

        # 3. GUARDAR EL CATÁLOGO INTELIGENTE PROTEGIENDO LOS DATOS EXISTENTES
        if nuevos_registros_catalogo:
            ruta_catalogo = os.path.join(self.base_dir, 'catalogo_cursos.csv')
            df_nuevos = pd.DataFrame(nuevos_registros_catalogo)
            
            if os.path.exists(ruta_catalogo):
                df_existente = pd.read_csv(ruta_catalogo, encoding='utf-8-sig')
                # Solo agregar los cursos que no existan previamente en el catálogo
                df_nuevos = df_nuevos[~df_nuevos['ID_Moodle'].isin(df_existente['ID_Moodle'])]
                df_final = pd.concat([df_existente, df_nuevos], ignore_index=True)
            else:
                df_final = df_nuevos
                
            df_final.to_csv(ruta_catalogo, index=False, encoding='utf-8-sig')
            logging.info(f"Catálogo de cursos actualizado. Tienes {len(df_final)} cursos catalogados en: {ruta_catalogo}")

    def terminate_session(self):
        """Cierra la instancia del WebDriver liberando los recursos de memoria."""
        logging.info("Terminando procesos y cerrando WebDriver.")
        try:
            self.driver.quit()
        except Exception:
            pass

if __name__ == "__main__":
    # --- CONFIGURACIÓN DE CREDENCIALES ---
    USER = 'daniel.zamora'
    PASS = 'Datic2025@'
    
    extractor = MoodleDataExtractor(username=USER, password=PASS)
    
    try:
        extractor.authenticate()
        target_course_ids = extractor.scan_courses()
        extractor.download_reports(target_course_ids)
    except Exception as e:
        logging.error(f"Interrupción de la ejecución principal: {e}")
        import sys
        sys.exit(1) # 👈 Esto fuerza a GitHub a detenerse y marcar el error en rojo
    finally:
        extractor.terminate_session()
