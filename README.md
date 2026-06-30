# Мониторинг заказов (Impala + Postgre)

Self-hosted дашборд по заказам. Два слабосвязанных компонента:

- **`agent/`** — Python-агент на корп-машине: подключается к Impala и Postgre,
  выполняет SQL, собирает межбазовый JOIN в DuckDB и пишет снапшот
  `data/<пайплайн>/snapshot.parquet` + `meta.json`.
- **`web/`** — статический дашборд (без бэкенда): читает снапшот, считает SQL прямо
  в браузере через DuckDB-WASM, рисует графики (Chart.js). Хостится на любой статике.

Браузер **никогда** не подключается к Impala/Postgre — только к заранее собранному снапшоту.

## Два пайплайна

| Пайплайн | Что собирает | Источник детализации | Расписание | Время сборки |
|---|---|---|---|---|
| **historical** | все заказы до сегодня | `drb.drb_iliyas_cust_order_full` (вся история) | раз в сутки (05:00) | ~9 мин |
| **today** | заказы только за текущий день | `crm2.crm2_crm_cust_order_day` + справочники | каждый час | ~1.5 мин |

Оба дают **одинаковую схему** (24 колонки), поэтому в вебе они переключаются одним
селектором в шапке, а дашборд/детализация/SQL — общие.

> Заказ `customer_orders` (Postgre) соединяется с данными Impala. Один SQL не выполнить
> на одном движке, поэтому агент тянет части по отдельности (с pushdown по ключам
> драйвера) и собирает JOIN локально в DuckDB — режим `combine: duckdb_join`.

```
orders_monitoring/
├─ agent/                          # корп-машина (НЕ публикуется как есть)
│  ├─ collector.py                 # сборка снапшота (точка входа, --pipeline)
│  ├─ scheduler.py                 # APScheduler: планирует все пайплайны
│  ├─ ssl_patch.py                 # monkey-patch SSL для Impala
│  ├─ db_impala.py / db_postgres.py
│  ├─ config.py                    # читает .env + pipelines/<name>.yaml
│  ├─ snapshot.py                  # атомарная запись parquet+meta
│  ├─ pipelines/
│  │   ├─ historical.yaml          # суточный пайплайн
│  │   └─ today.yaml               # ежечасный пайплайн
│  ├─ queries/*.sql                # SQL источников + assemble_*.sql (DuckDB)
│  ├─ .env.example                 # шаблон кредов → скопировать в .env
│  └─ requirements.txt
├─ web/                            # статический дашборд
│  ├─ index.html
│  ├─ config.json                  # заголовок, датасеты, хэши паролей
│  ├─ dashboard.json               # конфиг виджетов листа «Дашборд»
│  └─ src/*.js, styles.css
└─ data/                           # публикуемые снапшоты (генерируются агентом)
   ├─ historical/{snapshot.parquet, meta.json}
   └─ today/{snapshot.parquet, meta.json}
```

---

## Запуск

### 1. Установка и креды
```bat
cd agent
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```
Скопировать `.env.example` → `.env`, вписать креды Impala и Postgre (БД
`customer_orders_production`). `.env` в `.gitignore` — не коммитится.

### 2. Сборка снапшотов
```bat
python collector.py --pipeline today        :: ежечасный, текущий день (~1.5 мин)
python collector.py --pipeline historical   :: суточный, вся история (~9 мин)
```
Снапшот пишется атомарно в `data/<пайплайн>/`. При ошибке старый снапшот сохраняется,
в `meta.json` ставится `status: stale`.

### 3. Веб (из корня репозитория, чтобы был доступен и `web/`, и `data/`)
```bat
cd ..
python -m http.server 8000
```
Открыть <http://localhost:8000/web/index.html>. Пароли: **admin** → `admin123`,
**viewer** → `viewer123` (смена — ниже). В шапке селектор «Сегодня / Исторические».

### 4. Расписание
- **APScheduler в процессе:** `python scheduler.py` — планирует оба пайплайна по их
  `schedule` из yaml и делает первый прогон сразу.
- **Windows Task Scheduler:** две задачи, вызывающие
  `python collector.py --pipeline today` (ежечасно) и `--pipeline historical` (раз в сутки).

---

## Веб-дашборд

Три листа (общие для обоих датасетов — схема одинаковая):

- **Дашборд** — KPI (всего заказов, уникальных клиентов, пересоздано, каналов) +
  графики (по дням, по статусу, по каналам). Фильтры по статусу/каналу. Конфиг —
  `web/dashboard.json`.
- **Детализация** — таблица 24 колонок: сортировка, поиск, фильтры по колонкам,
  пагинация, экспорт CSV.
- **SQL** — ad-hoc запросы по снапшоту через DuckDB-WASM (таблица `data`), результат
  + быстрый график.

Свежесть (`generated_at` из `meta.json`) показывается в шапке; при `status: stale` —
плашка. Веб периодически опрашивает `meta.json` и при новом снапшоте мягко
перезагружает данные. Переключение датасета перезагружает соответствующий снапшот.

### Добавить/изменить пайплайн
Создать `agent/pipelines/<name>.yaml` (см. существующие как образец) и, при желании,
добавить датасет в `web/config.json → datasets`. Плейсхолдеры pushdown в запросах
источников: `{{col__ids}}`, `{{col__min}}`, `{{col__max}}` — берутся из колонок драйвера.

### Смена паролей
SHA-256 хэши в `web/config.json`. Сгенерировать:
```bash
printf '%s' 'НОВЫЙ_ПАРОЛЬ' | sha256sum
```
Вставить в `config.json` → `auth.adminHash` / `auth.viewerHash`.

---

## ⚠️ Защита данных (открытый блокер, раздел 8 PRD)

Парольный вход защищает **только UI**. На публичном хостинге `snapshot.parquet`
доступен по прямому URL в обход входа. Для корпоративных данных нужно выбрать опцию:

1. **Cloudflare Pages + Access (рекомендуется, бесплатно)** — серверная авторизация
   до отдачи файлов. Меняет только способ публикации в агенте.
2. **GitHub Pages + шифрование снапшота.**
3. **Приватный репозиторий + закрытый хостинг с логином.**

Публикация настраивается в `pipelines/*.yaml → publish` (сейчас `none` — только локально).

---

## Особенности реализации (учтены)

- **Межбазовые типы:** `customer_id`/id — integer в Postgre, double в Impala → приводятся
  к BIGINT в join. `created_at` (timestamptz) → наивное локальное время Asia/Almaty.
  Таймстемпы Impala — строки → приводятся к timestamp.
- **today vs historical:** `today` соединяет напрямую по `crm_order_id = day.id`;
  `historical` — по `customer_id` + окно дат (т.к. в полной таблице нет прямой связи).
  В `today` поле `order_close_date` берётся из `change_status_date` (прокси),
  `recreated_order` не вычисляется (=0) — у day-таблицы меньше полей. Правится в SQL.
- **Справочники today:** `cust_order_type`, `cust_order_status`, `sales_channel`,
  `po_reject_reason`, `bimeg_product_offer` (id → name).
