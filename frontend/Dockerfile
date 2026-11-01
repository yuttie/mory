# build stage (always runs natively on the build machine)
FROM --platform=$BUILDPLATFORM node:22-alpine AS build-stage
WORKDIR /app
# The Node image ships Corepack, which installs the pnpm packageManager names.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN VITE_APP_APPLICATION_ROOT="VITE_APP_APPLICATION_ROOT_VALUE_TO_BE_REPLACED_LATER" \
    VITE_APP_API_URL="VITE_APP_API_URL_VALUE_TO_BE_REPLACED_LATER" \
    pnpm run build

# production stage (per-target-architecture)
FROM nginx:stable-alpine AS production-stage
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
