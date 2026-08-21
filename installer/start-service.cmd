@echo off
rem Run by nssm (AppDirectory = backend/) on every service start,
rem the same command that runs inside the Docker container on every start: creates/
rem syncs the SQLite tables if missing (idempotent, no-op if the
rem database is already up to date). Without this step the service starts but
rem immediately crashes with "table AdminUser does not exist".
"..\node\node.exe" "node_modules\prisma\build\index.js" db push --skip-generate
"..\node\node.exe" "dist\index.js"
