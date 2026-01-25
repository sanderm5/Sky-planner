FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy everything
COPY . .

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Build the app
RUN pnpm --filter @skyplanner/app build

# Set working directory to app
WORKDIR /app/apps/app

# Expose port
EXPOSE 3000

# Set HOST to bind to all interfaces
ENV HOST=0.0.0.0

# Start
CMD ["npx", "tsx", "dist/server.js"]
