# Build-time backend URL — Vite bakes this into the static bundle, so it
# must be passed at image build time:
#   docker build --build-arg VITE_API_BASE_URL=https://api.yourdomain.com .
FROM node:20-slim AS build
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# Hide nginx version in the Server header for every server block in this image
# (complements server_tokens off in the site config below).
RUN sed -i 's/http {/http {\n    server_tokens off;/' /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
