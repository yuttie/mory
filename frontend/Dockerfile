# build stage
FROM node:20-alpine AS build-stage
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN VITE_APP_APPLICATION_ROOT="VITE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER" \
    VITE_APP_API_URL="VITE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER" \
    npm run build

# production stage
FROM nginx:stable-alpine AS production-stage
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD find /usr/share/nginx/html -type f -exec sed -i -e "s|/*VITE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER/*|${VITE_APP_APPLICATION_ROOT}|g" -e "s|/*VITE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER/*|${VITE_APP_API_URL}|g" '{}' \; && exec nginx -g 'daemon off;'
