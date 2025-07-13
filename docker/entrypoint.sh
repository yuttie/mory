#!/bin/sh
set -eu

find /usr/share/nginx/html -type f -exec sed \
    -i \
    -e "s|/*VITE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER/*|${VITE_APP_APPLICATION_ROOT}|g" \
    -e "s|/*VITE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER/*|${VITE_APP_API_URL}|g" \
    '{}' \
    \;
exec "$@"
