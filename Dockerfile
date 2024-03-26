# build stage
FROM node:20-alpine as build-stage
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
RUN VUE_APP_APPLICATION_ROOT="VUE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER" \
    VUE_APP_API_URL="VUE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER" \
    npx vue-cli-service build

# production stage
FROM nginx:stable-alpine as production-stage
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD find /usr/share/nginx/html -type f -exec sed -i -e "s|VUE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER/\+|${VUE_APP_APPLICATION_ROOT}|g" -e "s|VUE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER|${VUE_APP_API_URL}|g" '{}' \; && exec nginx -g 'daemon off;'
