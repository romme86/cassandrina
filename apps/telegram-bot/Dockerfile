# Build stage — requires Go 1.22
FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /telegram-bot .

# Final image — scratch for minimal footprint (~10 MB)
FROM scratch

COPY --from=builder /telegram-bot /telegram-bot
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

ENTRYPOINT ["/telegram-bot"]
