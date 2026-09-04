import os
import glob
import time
import re
import logging
import pandas as pd
from urllib.parse import unquote
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from webdriver_manager.chrome import ChromeDriverManager
import sys

# Configuración del registro de eventos (Logging)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

class MoodleDataExtractor:
    """
    Clase orquestadora para la extracción automatizada de datos operativos desde el LMS Moodle.
    Utiliza Selenium en modo headless para operar en infraestructuras de servidor sin interfaz gráfica.
    """
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
        """
        Prepara el entorno local creando el directorio de descargas o purgando
        archivos de ejecuciones anteriores para evitar colisiones de nomenclatura.
        """
        if not os.path.exists(self.download_dir):
            os.makedirs(self.download_dir)
            logging.info(f"Directorio de descargas inicializado en: {self.download_dir}")
        else:
            archivos_previos = glob.glob(os.path.join(self.download_dir, '*.csv'))
            for archivo in archivos_previos:
                try:
                    os.remove(archivo)
                except Exception as e:
                    logging.warning(f"Excepción al intentar eliminar {archivo}: {e}")
            logging.info("Directorio de descargas purgado exitosamente para la sesión actual.")

    def _initialize_driver(self):
        """
        Inicializa el WebDriver de Chrome con opciones optimizadas para servidores (CI/CD).
        """
        options = Options()
        
        # Opciones críticas para ejecución en entornos Cloud (GitHub Actions / Linux)
        options.add_argument('--headless')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
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
        """
        Gestiona el inicio de sesión en la plataforma institucional, incorporando
        tolerancia a fallos frente a redirecciones o requisitos de doble validación.
        """
        logging.info("Iniciando protocolo de autenticación.")
        try:
            self.driver.get(self.login_url)
            time.sleep(2)
            
            self._submit_credentials()
            time.sleep(3)
            
            # Verificación de persistencia en la pantalla de login (doble validación)
            if 'login' in self.driver.current_url:
                logging.warning("El servidor ha solicitado revalidación. Ejecutando reintento...")
                self._submit_credentials()
                time.sleep(3)
                
            if 'login' in self.driver.current_url:
                logging.error("Fallo definitivo de autenticación. Verifique la validez de las credenciales.")
                raise Exception("Acceso denegado por el LMS.")
            else:
                logging.info("Autenticación completada con éxito.")
                
        except Exception as e:
            # Captura de evidencia en caso de fallo crítico
            screenshot_path = os.path.join(self.base_dir, "error_login_moodle.png")
            self.driver.save_screenshot(screenshot_path)
            logging.error(f"Fallo crítico durante la autenticación. Evidencia guardada en: {screenshot_path}")
            raise e

    def _submit_credentials(self):
        """
        Inyecta las credenciales en el Modelo de Objetos del Documento (DOM) y envía la petición.
        """
        username_element = self.wait.until(EC.presence_of_element_located((By.ID, 'username')))
        username_element.clear()
        username_element.send_keys(self.username)
        
        password_element = self.driver.find_element(By.ID, 'password')
        password_element.clear()
        password_element.send_keys(self.password + Keys.RETURN)

    def scan_courses(self):
        """
        Analiza el DOM de la vista general para identificar los identificadores únicos
        de los cursos matriculados, utilizando rutinas de desplazamiento (scroll).
        """
        logging.info("Extrayendo identificadores de la oferta formativa disponible...")
        self.driver.get(self.courses_url)
        
        try:
            xpath_query = "//a[contains(@href, 'course') and contains(@href, 'id=')]"
            self.wait.until(EC.presence_of_element_located((By.XPATH, xpath_query)))
        except Exception:
            logging.warning("Latencia de red detectada. Incrementando tolerancia de espera...")
            time.sleep(5)

        # Desplazamiento iterativo para renderizar elementos dinámicos
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

        logging.info(f"Análisis finalizado. {len(course_ids)} cursos identificados en la sesión.")
        return list(course_ids)

    def download_reports(self, course_ids):
        """
        Itera sobre los cursos identificados, descarga los reportes de progreso en formato CSV
        y consolida un catálogo relacional de equivalencias (ID vs Nombre de curso).
        """
        if not course_ids:
            logging.warning("La matriz de cursos se encuentra vacía. Proceso de descarga abortado.")
            return

        total_courses = len(course_ids)
        nuevos_registros_catalogo = []

        for index, course_id in enumerate(course_ids, start=1):
            logging.info(f"Procesando identificador {course_id} ({index}/{total_courses})")
            
            if 'login' in self.driver.current_url:
                logging.info("Caducidad de sesión detectada. Restaurando conexión con el servidor...")
                self.authenticate()
                
            self.driver.get(f"{self.report_base_url}{course_id}")
            
            try:
                self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, 'generaltable')))
                time.sleep(1)
                
                # Extracción del nombre oficial del curso desde la cabecera
                try:
                    nombre_moodle = self.driver.find_element(By.TAG_NAME, 'h1').text
                except:
                    nombre_moodle = self.driver.title

                url_moodle = self.driver.current_url
                
                # Monitoreo del estado del directorio para capturar el archivo entrante
                archivos_antes = set(glob.glob(os.path.join(self.download_dir, '*.csv')))
                
                export_url = f"{self.report_base_url}{course_id}&dataformat=csv"
                self.driver.get(export_url)
                
                timeout = 15
                archivo_descargado = None
                while timeout > 0:
                    time.sleep(1)
                    archivos_despues = set(glob.glob(os.path.join(self.download_dir, '*.csv')))
                    nuevos = archivos_despues - archivos_antes
                    # Filtrar archivos temporales de descarga en proceso
                    nuevos_csv = [f for f in nuevos if not f.endswith('.crdownload')]
                    if nuevos_csv:
                        archivo_descargado = nuevos_csv[0]
                        break
                    timeout -= 1

                if archivo_descargado:
                    nombre_base = os.path.basename(archivo_descargado)
                    id_moodle_limpio = nombre_base.replace('progress.', '').replace('.csv', '')
                    
                    nuevos_registros_catalogo.append({
                        'ID_Moodle': id_moodle_limpio,
                        'Nombre_Moodle_Extraido': nombre_moodle,
                        'URL_Moodle': url_moodle,
                        'Nombre_Oficial_Forms': nombre_moodle
                    })
                    logging.info(f"[ÉXITO] Archivo descargado y catalogado: {id_moodle_limpio} -> {nombre_moodle}")
                else:
                    logging.warning(f"Tiempo de espera agotado al descargar el reporte del curso {course_id}")
                    
            except Exception as e:
                logging.info(f"Omitiendo curso {course_id} (Tabla de datos no identificada). Detalle: {e}")

        # Consolidación del catálogo inteligente protegiendo la integridad de datos previos
        if nuevos_registros_catalogo:
            ruta_catalogo = os.path.join(self.base_dir, 'catalogo_cursos.csv')
            df_nuevos = pd.DataFrame(nuevos_registros_catalogo)
            
            if os.path.exists(ruta_catalogo):
                df_existente = pd.read_csv(ruta_catalogo, encoding='utf-8-sig')
                df_nuevos = df_nuevos[~df_nuevos['ID_Moodle'].isin(df_existente['ID_Moodle'])]
                df_final = pd.concat([df_existente, df_nuevos], ignore_index=True)
            else:
                df_final = df_nuevos
                
            df_final.to_csv(ruta_catalogo, index=False, encoding='utf-8-sig')
            logging.info(f"Catálogo institucional actualizado. Registros totales consolidados: {len(df_final)}")

    def terminate_session(self):
        """
        Finaliza la instancia del WebDriver y libera los recursos de memoria asignados.
        """
        logging.info("Finalizando procesos de extracción y cerrando WebDriver.")
        try:
            self.driver.quit()
        except Exception:
            pass

if __name__ == "__main__":
    # --- CONFIGURACIÓN DE CREDENCIALES (Gestión Criptográfica) ---
    # Los valores se inyectan en tiempo de ejecución a través de Variables de Entorno (GitHub Secrets)
    USER = os.environ.get('MOODLE_USERNAME')
    PASS = os.environ.get('MOODLE_PASSWORD')

    if not USER or not PASS:
        logging.error("Credenciales ausentes. Configure MOODLE_USERNAME y MOODLE_PASSWORD en las variables de entorno.")
        sys.exit(1)
    
    extractor = MoodleDataExtractor(username=USER, password=PASS)
    
    try:
        extractor.authenticate()
        target_course_ids = extractor.scan_courses()
        extractor.download_reports(target_course_ids)
    except Exception as e:
        logging.error(f"Interrupción crítica de la ejecución principal: {e}")
        # Retorna un código de error al sistema operativo para notificar al motor de orquestación (CI/CD)
        sys.exit(1) 
    finally:
        extractor.terminate_session()
