
# vite-plugin-openapi-generator

[![npm](https://img.shields.io/npm/v/vite-plugin-openapi-generator.svg)](https://www.npmjs.com/package/vite-plugin-openapi-generator)
[![license](https://img.shields.io/npm/l/vite-plugin-openapi-generator.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/clement83/vite-plugin-openapi-generator.svg)](https://github.com/clement83/vite-plugin-openapi-generator)

> A Vite plugin to generate TypeScript DTOs and client classes from OpenAPI YAML files.

---

## ✨ Features

- 🔍 Scans folders recursively for `.yml` or `.yaml`
- 📦 Generates DTO (`models`) classes from schemas
- 🔧 Generates typed HTTP client methods from OpenAPI paths
- 🗂 Organizes output into per-API `generated/` folders
- 💡 Fully type-safe with clean TypeScript output

---

## 📦 Installation

Install it as a dev dependency:

```bash
npm install -D vite-plugin-openapi-generator
# or
yarn add -D vite-plugin-openapi-generator
````

---

## ⚙️ Usage

### Basic setup

In your `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import openApiGenerator from 'vite-plugin-openapi-generator'

export default defineConfig({
  plugins: [
    openApiGenerator({
      sourceDir: './src/infrastructure',   // Folder containing OpenAPI files
      outputDir: './src/infrastructure'    // Base output folder for generated code
    })
  ]
})
```

When you run Vite (`vite`, `vite dev`, `vite build`), the plugin will:

* scan every subfolder inside `sourceDir`
* look for a `.yml` or `.yaml` OpenAPI file
* generate:

  * DTOs in `generated/models/*.ts`
  * a client file `generated/openApi.ts` with typed fetch/post methods

---

## 🧱 Example Structure

### Input

```
src/infrastructure/
  users/
    users-api.yml
  auth/
    auth-api.yaml
```

### Output (automatically generated)

```
src/infrastructure/
  users/
    generated/
      models/
        User.ts
        Profile.ts
      openApi.ts
  auth/
    generated/
      models/
        Token.ts
      openApi.ts
```

---

## 🧪 Example OpenAPI File (users-api.yml)

```yaml
openapi: 3.0.0
info:
  title: Users API
  version: 1.0.0
paths:
  /users:
    get:
      summary: Get all users
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'

components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
```

### Generated DTO (`models/User.ts`)

```ts
export class User {
  id!: string
  name!: string
}
```

### Generated client (`openApi.ts`)

```ts
import { User } from './models/User'

export async function getUsers(): Promise<User[]> {
  const res = await fetch(`/users`)
  return res.json()
}
```

---

## 🧩 Options

| Option      | Type     | Required | Description                                    |
| ----------- | -------- | -------- | ---------------------------------------------- |
| `sourceDir` | `string` | ✅        | Folder to recursively search for OpenAPI files |
| `outputDir` | `string` | ✅        | Folder where generated code will be written    |

---

## 🛠 Development & Contributing

### Clone the repository

```bash
git clone https://github.com/tonpseudo/vite-plugin-openapi-generator.git
cd vite-plugin-openapi-generator
```

### Install dependencies

```bash
npm install
# or
yarn install
```

### Build plugin

```bash
npm run build
```

### Watch for changes

```bash
npm run dev
```

### Publish to npm

Make sure your version is bumped in `package.json`:

```bash
npm version patch
npm publish --access public
```

---

## 🧪 Testing your plugin locally

You can test it with a Vite app by using `npm link`:

```bash
cd vite-plugin-openapi-generator
npm link

# Then in your app project
cd my-vite-app
npm link vite-plugin-openapi-generator
```

---

## 📜 License

MIT © 2025 [Clement](https://github.com/clement83)

