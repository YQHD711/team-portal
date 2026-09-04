FROM python:3.11-slim

WORKDIR /app

# 非 root 用户(审计建议 #3:容器以 root 运行是横向移动风险)
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

COPY requirements.txt .
# PIP_INDEX_URL 默认阿里源(国内开发/CI),国外/CI 可用 --build-arg PIP_INDEX_URL=https://pypi.org/simple 覆盖
ARG PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} -r requirements.txt

COPY . .
RUN chown -R app:app /app
USER app

EXPOSE 9001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9001"]
