// Vorlage — muss vor allen anderen Importen stehen, die process.env lesen
import { loadEnvFile } from "node:process";
try { loadEnvFile(); } catch { /* keine .env: echte Umgebungsvariablen nutzen (Produktion) */ }
