rm -rf dist
pnpm run build
scp -r dist/* aprillie:/root/docker-service-aprillie/basic/etc/nginx/html/