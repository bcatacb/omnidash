# syntax=docker/dockerfile:1.6
FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/hungryshim ./

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/hungryshim /usr/local/bin/hungryshim
EXPOSE 8008
USER nonroot
ENTRYPOINT ["/usr/local/bin/hungryshim"]
