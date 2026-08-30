FROM python:3.11-slim

WORKDIR /app

# 非 root 用户(审计建议 #3:容器以 root 运行是横向移动风险)
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chown -R app:app /app
USER app

EXPOSE 9001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9001"]
