@echo off
echo ============================================
echo   Pharmacie du Centre — Installation
echo ============================================
echo.
echo Verification de Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Node.js n'est pas installe sur ce poste.
    echo  Telechargez-le sur : https://nodejs.org
    echo  Installez la version LTS, puis relancez ce fichier.
    echo.
    pause
    exit /b 1
)
echo  Node.js detecte !
echo.
echo Installation des composants...
cd /d "%~dp0"
call npm install
echo.
echo ============================================
echo   Installation terminee avec succes !
echo   Lancez "demarrer.bat" pour demarrer.
echo ============================================
pause
