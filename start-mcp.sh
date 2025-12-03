#!/bin/bash
cd /home/masterp/My_home_space/masterp/homeassistant-mcp
export $(grep -v '^#' .env | xargs)
exec node dist/index.cjs
