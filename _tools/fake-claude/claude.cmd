@echo off
rem A stand-in `claude` for drives that measure Locust while a reply streams. See fake-claude.mjs.
node "%~dp0fake-claude.mjs" %*
