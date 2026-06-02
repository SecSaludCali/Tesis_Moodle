import os
import logging
import pandas as pd
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Configuración de registro
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class GoogleFormsETL:
    def __init__(self):
        # Permisos requeridos: Lectura de Drive y lectura de Formularios/Respuestas
        self.scopes = [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/forms.responses.readonly',
            'https://www.googleapis.com/auth/forms.body.readonly'
        ]
        self.credentials = None
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.token_path = os.path.join(self.base_dir, 'token.json')
        self.credentials_path = os.path.join(self.base_dir, 'credentials.json')

    def authenticate(self):
        """Maneja el flujo de autenticación OAuth 2.0."""
        logging.info("Verificando credenciales de acceso a Google Cloud...")
        if os.path.exists(self.token_path):
            self.credentials = Credentials.from_authorized_user_file(self.token_path, self.scopes)
        
        if not self.credentials or not self.credentials.valid:
            if self.credentials and self.credentials.expired and self.credentials.refresh_token:
                self.credentials.refresh(Request())
            else:
                if not os.path.exists(self.credentials_path):
                    raise FileNotFoundError(f"No se encontró {self.credentials_path}.")
                
                flow = InstalledAppFlow.from_client_secrets_file(self.credentials_path, self.scopes)
                self.credentials = flow.run_local_server(port=0)
            
            with open(self.token_path, 'w') as token_file:
                token_file.write(self.credentials.to_json())
        logging.info("Autenticación exitosa.")

    def fetch_form_data(self):
        """Busca formularios, extrae respuestas y consolida un DataFrame maestro."""
        drive_service = build('drive', 'v3', credentials=self.credentials)
        forms_service = build('forms', 'v1', credentials=self.credentials)

        # Consulta estructurada para buscar los formularios específicos
        query = "mimeType='application/vnd.google-apps.form' and name contains '- Satisfacción del Curso virtual -'"
        logging.info("Ejecutando consulta en Google Drive...")
        
        results = drive_service.files().list(q=query, fields="files(id, name)").execute()
        forms_list = results.get('files', [])

        if not forms_list:
            logging.warning("No se encontraron formularios que coincidan con los parámetros de búsqueda.")
            return

        logging.info(f"Se detectaron {len(forms_list)} formularios. Iniciando extracción de respuestas...")
        
        all_responses_data = []

        for index, form in enumerate(forms_list, start=1):
            form_id = form['id']
            form_name = form['name']
            logging.info(f"Procesando formulario ({index}/{len(forms_list)}): {form_name}")

            try:
                # 1. Obtener la metadata del formulario (preguntas)
                form_metadata = forms_service.forms().get(formId=form_id).execute()
                question_map = {}
                
                for item in form_metadata.get('items', []):
                    if 'questionItem' in item:
                        q_id = item['questionItem']['question']['questionId']
                        question_map[q_id] = item['title']

                # 2. Obtener las respuestas
                responses_data = forms_service.forms().responses().list(formId=form_id).execute()
                responses = responses_data.get('responses', [])

                # 3. Transformar estructura anidada JSON a tabla plana
                for response in responses:
                    # EXTRAEMOS LA MARCA TEMPORAL AQUÍ (createTime)
                    row_data = {
                        'ID_Formulario': form_id, 
                        'Nombre_Curso': form_name,
                        'Marca temporal': response.get('createTime')
                    }
                    answers = response.get('answers', {})
                    
                    for q_id, q_text in question_map.items():
                        if q_id in answers:
                            try:
                                # Extracción del valor textual de la respuesta
                                answer_value = answers[q_id]['textAnswers']['answers'][0]['value']
                                row_data[q_text] = answer_value
                            except (KeyError, IndexError):
                                row_data[q_text] = None
                        else:
                            row_data[q_text] = None
                            
                    all_responses_data.append(row_data)
                    
            except Exception as e:
                logging.error(f"Error procesando formulario {form_name}: {e}")

        # Consolidación de datos
        if all_responses_data:
            final_df = pd.DataFrame(all_responses_data)
            output_path = os.path.join(self.base_dir, 'demografia_consolidada.csv')
            final_df.to_csv(output_path, index=False, encoding='utf-8')
            logging.info(f"Procesamiento finalizado. {len(final_df)} respuestas consolidadas exportadas a {output_path}")
        else:
            logging.warning("No se extrajeron respuestas de los formularios procesados.")

if __name__ == "__main__":
    etl = GoogleFormsETL()
    try:
        etl.authenticate()
        etl.fetch_form_data()
    except Exception as error:
        logging.critical(f"Falla crítica en la ejecución: {error}")
