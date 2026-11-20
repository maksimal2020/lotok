# Ветки и порядок выката

```
 задача ──► test ──(проверено)──► dev ──(проверено)──► main ──(подтверждение)──► Kubernetes (production)
           compose                compose               CI: тесты + E2E → образы ghcr.io → helm upgrade
```

| Ветка | Назначение | Как проверяется |
|---|---|---|
| `test` | Новые изменения: быстрая проверка дизайна и функционала | Локально `docker compose up -d --build` (демо-данные, тестовые платежи, Mailpit). CI: типы, unit, integration, запуск всего стека в compose |
| `dev` | Принятые изменения, кандидат в релиз | Пока — так же, через compose. CI: всё то же + E2E и интеграционные тесты на OpenSearch. Когда появится стенд в k8s — автодеплой на него (`values-staging.yaml`) |
| `main` | Продакшен | CI: полный набор тестов → сборка образов `ghcr.io/<owner>/lotok/{api,web,admin}` → деплой в Kubernetes после ручного подтверждения |

## Правила
1. **Код и конфигурация во всех ветках одинаковые.** `docker-compose.yml` (локальный запуск) и Helm-чарт `infra/helm/lotok` (Kubernetes) лежат рядом и друг другу не мешают. При переходе между ветками ничего не переписывается: сливается ровно то, что проверили.
2. Различия окружений — только в файлах значений и секретах:
   - локально — `docker-compose.yml` (+ необязательный `.env`);
   - production — `infra/helm/lotok/values-production.yaml` (несекретное) и Kubernetes Secret `lotok-secrets` (секреты из secret storage).
3. Новая работа всегда начинается в `test`. Продвижение — только слиянием вперёд: `test → dev → main`. Обратные слияния не нужны; исправления тоже идут через `test`.
4. Срочное исправление в production: ветка `hotfix/*` от `main` → PR в `main` → затем слить `main` в `dev` и `test`, чтобы ветки не разошлись.

## Команды продвижения
```bash
git checkout dev && git pull && git merge --ff-only test && git push
```
```bash
git checkout main && git pull && git merge --ff-only dev && git push
```
`--ff-only` гарантирует, что в следующую ветку попадают ровно те коммиты, которые проверены в предыдущей. Если слияние не fast-forward — значит ветки разошлись, нужно разобраться, а не создавать merge-коммит вслепую. При включённой защите веток то же делается через Pull Request `test → dev` и `dev → main`.

## Настройка GitHub (делается владельцем репозитория)
1. **Защита веток** — Settings → Rules → Rulesets (или Branches → Branch protection rules) для `main` и `dev`:
   запрет прямого push и force-push, слияние только через Pull Request, обязательные проверки CI (`typecheck`, `unit`, `integration`, `e2e`; для `dev` также `compose`).
2. **Environment `production`** — Settings → Environments → New environment → `production` → Required reviewers (кто подтверждает выкат). Секрет окружения `KUBE_CONFIG` — kubeconfig кластера в base64 (`base64 -w0 kubeconfig`), с правами только на namespace `lotok`.
3. **Variables** (Settings → Secrets and variables → Actions → Variables):
   - `SITE_URL`, `ADMIN_SITE_URL` — публичные адреса сайта и админки (встраиваются в сборку web);
   - `K8S_DEPLOY_ENABLED=true` — включить деплой, когда кластер и секреты готовы. Пока переменной нет, `main` только собирает и публикует образы.
4. **Доступ кластера к образам** (репозиторий приватный, пакеты ghcr.io тоже): создать в кластере Secret `ghcr-pull`:
   ```bash
   kubectl -n lotok create secret docker-registry ghcr-pull --docker-server=ghcr.io --docker-username=<github-логин> --docker-password=<PAT с правом read:packages>
   ```

## Что делает CI (`.github/workflows/ci.yml`)
| Job | test | dev | main | PR → dev | PR → main |
|---|:-:|:-:|:-:|:-:|:-:|
| typecheck, unit, integration (PostgreSQL + Redis) | ✓ | ✓ | ✓ | ✓ | ✓ |
| compose — весь стек в Docker Compose + smoke-проверки | ✓ | ✓ | | ✓ | |
| integration на OpenSearch | | ✓ | ✓ | | ✓ |
| E2E Playwright (desktop + mobile) | | ✓ | ✓ | ✓ | ✓ |
| images — сборка и публикация в ghcr.io | | | ✓ | | |
| deploy — `helm upgrade --atomic` (миграции pre-upgrade hook'ом) | | | ✓ (при `K8S_DEPLOY_ENABLED`) | | |
