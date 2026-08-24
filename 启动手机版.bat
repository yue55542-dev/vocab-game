@echo off
chcp 65001 >nul
title 词力闯关 - 手机版服务器
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo 正在启动服务器，请稍候...
  node tools\serve.mjs
) else (
  echo 没有找到 Node.js。请先到 https://nodejs.org 安装后重新双击本文件。
  pause
)
