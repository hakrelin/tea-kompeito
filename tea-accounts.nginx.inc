location ^~ /api/ {
    proxy_pass http://127.0.0.1:8778;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_cache off;
}

location = /admin { return 308 /admin/$is_args$args; }

location ^~ /admin/ {
    client_max_body_size 128m;
    proxy_read_timeout 120s;
    proxy_pass http://127.0.0.1:8778;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_cache off;
}

location = /assets/js/content.js { return 404; }

location ~ ^/(staff|news|picks|about|account)\.html$ {
    try_files /index.html =404;
}
