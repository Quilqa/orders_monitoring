# Подключение к Impala из Python

Инструкция описывает, как подключиться к корпоративному кластеру Impala через Python-библиотеку `impyla`. Используется в проекте `metrics_audit`.

---

## Параметры кластера

| Параметр | Значение |
|---|---|
| Основной хост | `bdas-worker-08.bdpak.telecom.kz` |
| Резервный хост | `bdas-utility-01.bdpak.telecom.kz` |
| Порт | `21050` |
| База данных | `drb` |
| Аутентификация | PLAIN (логин + пароль) |
| SSL | включён (`use_ssl=True`) |
| Доступ | только из внутренней сети или через VPN |

> **Username и password** хранятся в `config.yaml` и не коммитятся в git.

---

## Зависимости

`impyla` работает через протокол Thrift напрямую — Java-драйверы (JDBC `.zip`) **не нужны**, они только для DBeaver/Tableau.

```
# requirements.txt
impyla==0.19.0
thrift==0.16.0
thrift-sasl==0.4.3
pure-sasl>=0.6.2   # вместо sasl — не требует C++ компилятора на Windows
```

> **Важно:** пакет `sasl==0.3.1` на Windows не устанавливается без Microsoft C++ Build Tools.  
> Используйте `pure-sasl` — он устанавливается автоматически как зависимость `thrift-sasl`.

Установка:
```bat
python -m venv venv
venv\Scripts\activate
pip install impyla==0.19.0 thrift==0.16.0 thrift-sasl==0.4.3 pandas
```

---

## Проблема с SSL и её решение

При подключении с `use_ssl=True` возникает ошибка:

```
ssl.SSLError: [SSL: SSLV3_ALERT_HANDSHAKE_FAILURE] sslv3 alert handshake failure
```

**Причина:** сервер Impala использует устаревшие cipher suites, которые Python 3.10+ отклоняет по умолчанию (security level 2).

**Решение:** monkey-patch SSL-контекста библиотеки `thrift` перед подключением:

```python
import ssl
import thrift.transport.TSSLSocket as _mod

def _patch_thrift_ssl():
    _orig = _mod.TSSLSocket.__init__

    def _patched(self, *a, **kw):
        _orig(self, *a, **kw)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
        self._context = ctx

    _mod.TSSLSocket.__init__ = _patched

# Вызвать ДО impyla_connect:
_patch_thrift_ssl()
```

Это нужно вызвать один раз перед первым подключением. Патч снижает проверку сертификата и разрешает старые шифры — приемлемо для внутренней сети за VPN.

---

## Подключение

```python
from impala.dbapi import connect

conn = connect(
    host="bdas-worker-08.bdpak.telecom.kz",
    port=21050,
    database="drb",
    user="<username>",        # из config.yaml
    password="<password>",    # из config.yaml
    use_ssl=True,
    auth_mechanism="PLAIN",   # AuthMech=3 в JDBC-терминологии
    timeout=60,
)
```

С резервным хостом — оберните в try/except и переключитесь на `bdas-utility-01.bdpak.telecom.kz` при ошибке.

---

## Выполнение запроса

```python
cursor = conn.cursor()
cursor.execute("SELECT event_type, entry_date, count(*) AS cnt FROM drb.drb_iliyas_amplitude_metrics_full GROUP BY 1, 2")

import pandas as pd
rows = cursor.fetchall()
columns = [desc[0] for desc in cursor.description]
df = pd.DataFrame(rows, columns=columns)
```

---

## Схема таблицы метрик

**`drb.drb_iliyas_amplitude_metrics_full`**

| Колонка | Тип | Описание |
|---|---|---|
| `metrics` | string | Платформа: `TelecomKz` или `Aitu` |
| `event_type` | string | Название метрики (событие Amplitude) |
| `entry_date` | string | Дата события (`YYYY-MM-DD`) |
| `event_time` | string | Полная метка времени |
| `event_properties` | string | JSON с параметрами события |
| `platform` | string | `android` / `iOS` / `Web` |
| ... | | прочие поля пользователя и устройства |

> **Внимание:** колонка `metrics` содержит **платформу** (`TelecomKz`/`Aitu`), а не название метрики.  
> Название метрики — в колонке `event_type`.

**`external_sources.amplitude_loyalty_program_logs`**

| Колонка | Тип | Описание |
|---|---|---|
| `event_type` | string | Название метрики |
| `event_time` | string | Полная метка времени (дата берётся через `left(event_time, 10)`) |
| ... | | прочие поля |

---

## Агрегирующий запрос проекта

```sql
-- TelecomKz (все метрики) + Aitu (только whitelist)
SELECT metrics AS platform, event_type AS metrics, entry_date, count(*) AS cnt
FROM drb.drb_iliyas_amplitude_metrics_full
WHERE event_type IS NOT NULL AND event_type != ''
  AND (
    metrics = 'TelecomKz'
    OR (metrics = 'Aitu' AND event_type IN ('miniapp_opened', 'main_tab_selected', ...))
  )
GROUP BY 1, 2, 3

UNION ALL

-- Loyalty (без временных акционных метрик)
SELECT 'Loyalty' AS platform, event_type AS metrics,
       left(event_time, 10) AS entry_date, count(*) AS cnt
FROM external_sources.amplitude_loyalty_program_logs
WHERE event_type IS NOT NULL AND event_type != ''
  AND event_type NOT LIKE 'detail_promo_%'
  AND event_type NOT LIKE 'company_promo_%'
GROUP BY 1, 2, 3
```

---

## Типичные ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `SSLV3_ALERT_HANDSHAKE_FAILURE` | Старые cipher suites на сервере | Применить `_patch_thrift_ssl()` (см. выше) |
| `ConnectionRefusedError` / `TSocket read 0 bytes` | VPN не подключён | Подключить VPN и повторить |
| `AuthenticationError` | Неверный логин/пароль | Проверить `config.yaml` |
| `sasl` не устанавливается | Нет C++ Build Tools | Использовать `pure-sasl` (устанавливается автоматически) |
| `ssl.PROTOCOL_TLS is deprecated` | Предупреждение thrift 0.16 | Некритично, патч перезаписывает контекст после |
