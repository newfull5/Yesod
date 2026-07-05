# Stage 1: frontend build
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Go build (frontend embedded via embed.FS, CGO-free sqlite)
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY internal/ internal/
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /yesod .

# Stage 3: minimal runtime
FROM scratch
COPY --from=build /yesod /yesod
ENV YESOD_DB=/data/yesod.db
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/yesod"]
