@echo off
rem Eseguito da nssm (AppDirectory = backend/) a ogni avvio del servizio,
rem stesso comando che gira dentro il container Docker a ogni avvio: crea/
rem sincronizza le tabelle SQLite se mancano (idempotente, no-op se il
rem database e' gia' aggiornato). Senza questo passo il servizio parte ma
rem crasha subito con "table AdminUser does not exist".
"..\node\node.exe" "node_modules\prisma\build\index.js" db push --skip-generate
"..\node\node.exe" "dist\index.js"
