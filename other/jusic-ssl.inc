# jusic 听歌站：SSL 公共参数（被各域名 443 server 块 include）
# 改这里 = 同时作用于 zjz.northwind.site 和 zjz.tea-sugar.xyz
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSLJUSIC:5m;
ssl_session_timeout 10m;

client_max_body_size 20m;
