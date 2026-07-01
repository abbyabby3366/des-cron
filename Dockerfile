FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Set default production env variables
ENV NODE_ENV=production
ENV TZ=Asia/Kuala_Lumpur
ENV PORT=3000

# Command to run application
CMD ["npm", "start"]

