#!/bin/sh

# favicon
inkscape --export-type=png --export-area-page -w 512 -h 512 -o public/favicon.png logo.svg

# PWA icons
inkscape --export-type=png --export-area-page -w  32 -h  32 -o public/img/icons/favicon-32x32.png logo.svg
inkscape --export-type=png --export-area-page -w  16 -h  16 -o public/img/icons/favicon-16x16.png logo.svg
inkscape --export-type=png --export-area-page -w 152 -h 152 -o public/img/icons/apple-touch-icon-152x152.png logo.svg
inkscape --export-type=png --export-area-page -w 144 -h 144 -o public/img/icons/msapplication-icon-144x144.png logo.svg
inkscape --export-type=png --export-area-page -w 192 -h 192 -o public/img/icons/android-chrome-192x192.png logo.svg
inkscape --export-type=png --export-area-page -w 512 -h 512 -o public/img/icons/android-chrome-512x512.png logo.svg

# For About.vue
inkscape --export-type=png --export-area-page -w 192 -h 192 -o src/assets/logo.png logo.svg
