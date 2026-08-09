FROM python:3.14.0-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 zipo \
  && useradd --system --uid 10001 --gid zipo --home-dir /nonexistent zipo

WORKDIR /app
COPY --chown=zipo:zipo requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=zipo:zipo . .
RUN mkdir -p /data && chown zipo:zipo /data

USER zipo
EXPOSE 8090
CMD ["python", "app.py"]
