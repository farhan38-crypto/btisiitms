import os
import tempfile

# Run the API tests against a throwaway database and never call real
# external services (SMTP / Gemini). load_dotenv() does not override
# variables that are already set, so these win over backend/.env.
os.environ.setdefault('DB_NAME', 'itsm_test')
os.environ['SMTP_HOST'] = ''
for key in ('LLM_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'):
    os.environ[key] = ''
os.environ.setdefault('JWT_SECRET', 'test-only-secret')
os.environ.setdefault('LOG_DIR', tempfile.mkdtemp(prefix='bits-reports-logs-'))
