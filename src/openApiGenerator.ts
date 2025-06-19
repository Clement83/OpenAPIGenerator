import { Plugin } from "vite"
import fs from "fs/promises"
import path from "path"
import yaml from "js-yaml"

interface OpenAPIGeneratorOptions {
    sourceDir: string
}

interface OpenAPISpec {
    servers?: Array<{ url: string; description?: string }>
    paths: Record<string, Record<string, any>>
    components?: {
        schemas?: Record<string, any>
    }
    info?: {
        title?: string
        version?: string
    }
}

interface SchemaProperty {
    type?: string
    format?: string
    items?: SchemaProperty
    properties?: Record<string, SchemaProperty>
    $ref?: string
    enum?: any[]
    required?: string[]
}

interface GeneratedFile {
    fileName: string
    className: string
    baseUrl: string
    spec: OpenAPISpec
}

export function openApiGenerator(options: OpenAPIGeneratorOptions): Plugin {
    return {
        name: "openapi-generator",
        buildStart: async () => {
            await generateFromOpenAPIFiles(options)
        },
    }
}

async function generateFromOpenAPIFiles(options: OpenAPIGeneratorOptions) {
    const { sourceDir } = options

    async function walk(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const files: string[] = []

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                files.push(...(await walk(fullPath)))
            } else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
                files.push(fullPath)
            }
        }

        return files
    }

    try {
        const yamlFilePaths = await walk(sourceDir)

        if (yamlFilePaths.length === 0) {
            console.log(`⚠️  Aucun fichier YAML trouvé dans ${sourceDir}`)
            return
        }

        console.log(`📁 ${yamlFilePaths.length} fichier(s) OpenAPI trouvé(s) dans ${sourceDir}`)

        for (const yamlFilePath of yamlFilePaths) {
            try {
                const specContent = await fs.readFile(yamlFilePath, "utf-8")
                const spec: OpenAPISpec = yaml.load(specContent) as OpenAPISpec

                const baseUrl = spec.servers?.[0]?.url ?? ""

                const fileName = path.basename(yamlFilePath, path.extname(yamlFilePath))
                const className = pascalCase(fileName) + "Client"

                const generatedDir = path.join(path.dirname(yamlFilePath), "generated")
                const dtoDir = path.join(generatedDir, "models")
                const clientDir = generatedDir

                await fs.mkdir(dtoDir, { recursive: true })

                const allSchemas = spec.components?.schemas || {}

                // DTOs
                if (Object.keys(allSchemas).length > 0) {
                    await generateDTOs(allSchemas, dtoDir)
                    console.log(`✅ DTO(s) générés pour ${fileName}`)
                }

                // Client
                await generateClientClass(
                    {
                        fileName,
                        className,
                        baseUrl,
                        spec,
                    },
                    clientDir,
                    "openApi.ts" // destination personnalisée
                )

                console.log(`✅ Client généré pour ${fileName}`)
            } catch (e) {
                console.error(`❌ Erreur lors du traitement de ${yamlFilePath}`, e)
            }
        }

        console.log("✅ Génération terminée.")
    } catch (error) {
        console.error("❌ Erreur lors du scan des fichiers:", error)
    }
}

async function generateDTOs(schemas: Record<string, any>, dtoDir: string) {
    const dtoExports: string[] = []

    for (const [schemaName, schema] of Object.entries(schemas)) {
        const dtoContent = generateDTOType(schemaName, schema, schemas)
        const fileName = `${schemaName}.ts`

        await fs.writeFile(path.join(dtoDir, fileName), dtoContent)
        dtoExports.push(`export type { ${schemaName} } from './${schemaName}';`)
    }

    // Créer un fichier index.ts pour exporter tous les DTOs
    const indexContent = dtoExports.join("\n") + "\n"
    await fs.writeFile(path.join(dtoDir, "index.ts"), indexContent)
}

function generateDTOType(name: string, schema: any, allSchemas: Record<string, any>): string {
    const usedRefs = new Set<string>();

    // 🔹 Cas des enums simples
    if (schema.enum) {
        const enumType = schema.enum.map((v: any) => (typeof v === "string" ? `'${v}'` : v)).join(" | ");
        return `export type ${name} = ${enumType};\n`;
    }

    let properties: Record<string, SchemaProperty> = {};
    let requiredProps = new Set<string>(schema.required || []);

    const inheritance: string[] = [];

    if (schema.allOf) {
        for (const part of schema.allOf) {
            if (part.$ref) {
                const refName = part.$ref.split("/").pop();
                if (refName) {
                    usedRefs.add(refName);
                    inheritance.push(refName);
                }
            } else if (part.type === "object" && part.properties) {
                Object.assign(properties, part.properties);
                (part.required || []).forEach((r: string) => requiredProps.add(r));
            }
        }
    } else {
        properties = schema.properties || {};
        (schema.required || []).forEach((r: string) => requiredProps.add(r));
    }

    // 🔹 Collecte les refs à importer
    function collectRefs(propSchema: SchemaProperty) {
        if (propSchema.$ref) {
            const refName = propSchema.$ref.split("/").pop();
            if (refName && refName !== name) {
                usedRefs.add(refName);
            }
        }
        if (propSchema.type === "array" && propSchema.items) {
            collectRefs(propSchema.items);
        }
        if (propSchema.type === "object" && propSchema.properties) {
            Object.values(propSchema.properties).forEach(collectRefs);
        }
    }

    Object.values(properties).forEach((prop) => collectRefs(prop as SchemaProperty));

    // 🔹 Génère les imports
    let importSection = "";
    if (usedRefs.size > 0) {
        importSection =
            Array.from(usedRefs)
                .map((ref) => `import type { ${ref} } from './${ref}';`)
                .join("\n") + "\n\n";
    }

    // 🔹 Génère le type/interface
    const extendsLine = inheritance.length > 0 ? ` extends ${inheritance.join(", ")}` : "";
    let typeContent = `${importSection}export interface ${name}${extendsLine} {\n`;

    for (const [propName, propSchema] of Object.entries(properties)) {
        const isRequired = requiredProps.has(propName);
        const propType = getTypeScriptType(propSchema as SchemaProperty, allSchemas);
        const optional = isRequired ? "" : "?";
        typeContent += `  ${propName}${optional}: ${propType};\n`;
    }

    typeContent += "}\n";
    return typeContent;
}


function getTypeScriptType(schema: SchemaProperty, allSchemas: Record<string, any>): string {
    if (schema.$ref) {
        // Résoudre la référence
        const refName = schema.$ref.split("/").pop()
        return refName || "any"
    }

    if (schema.enum) {
        return schema.enum.map((v) => (typeof v === "string" ? `'${v}'` : v)).join(" | ")
    }

    switch (schema.type) {
        case "string":
            return schema.format === "date-time" || schema.format === "date" ? "Date" : "string"
        case "number":
        case "integer":
            return "number"
        case "boolean":
            return "boolean"
        case "array":
            return `${schema.items ? getTypeScriptType(schema.items, allSchemas) : "any"}[]`
        case "object":
            if (schema.properties) {
                const props = Object.entries(schema.properties)
                    .map(([key, prop]) => `${key}: ${getTypeScriptType(prop as SchemaProperty, allSchemas)}`)
                    .join("; ")
                return `{ ${props} }`
            }
            return "Record<string, any>"
        default:
            return "any"
    }
}

async function generateClientClass(fileInfo: GeneratedFile, clientsDir: string, fileNameOverride?: string) {
    const { className, baseUrl, spec, fileName } = fileInfo

    let clientContent = `/**
 * Client API généré pour ${fileName}
 * Base URL: ${baseUrl}
 */
export class ${className} {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || '${baseUrl}').replace(/\\/$/, '');
  }

  /**
   * Obtient l'URL de base configurée
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

`

    const methods: string[] = []

    for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) {
                continue
            }

            const operationId = operation.operationId || generateOperationId(method, pathTemplate)
            // 🔹 MODIFICATION: Préfixer le nom de la méthode avec le verbe HTTP
            const methodName = method + pascalCase(operationId)

            // Extraire les paramètres du path
            const pathParams = extractPathParameters(pathTemplate)
            const queryParams = extractQueryParameters(operation)

            // Générer la documentation JSDoc
            let jsdoc = `  /**\n`
            jsdoc += `   * ${operation.summary || `${method.toUpperCase()} ${pathTemplate}`}\n`
            if (operation.description) {
                jsdoc += `   * ${operation.description}\n`
            }

            // Documenter les paramètres
            pathParams.forEach((param) => {
                jsdoc += `   * @param ${param} Path parameter\n`
            })
            if (queryParams.length > 0) {
                jsdoc += `   * @param queryParams Query parameters\n`
            }
            jsdoc += `   * @returns URL for the ${methodName} endpoint\n`
            jsdoc += `   */\n`

            let methodSignature = `${methodName}(`
            const params: string[] = []

            // Paramètres de path
            if (pathParams.length > 0) {
                pathParams.forEach((param) => {
                    params.push(`${param}: string | number`)
                })
            }

            // Paramètres de query
            if (queryParams.length > 0) {
                params.push(`queryParams?: { ${queryParams.map((p) => `${p}?: any`).join("; ")} }`)
            }

            methodSignature += params.join(", ") + "): string"

            // Corps de la méthode
            let methodBody = `    let url = this.baseUrl + '${pathTemplate}';\n`

            // Remplacer les paramètres de path
            pathParams.forEach((param) => {
                methodBody += `    url = url.replace('{${param}}', String(${param}));\n`
            })

            // Ajouter les paramètres de query
            if (queryParams.length > 0) {
                methodBody += `    if (queryParams) {\n`
                methodBody += `      const searchParams = new URLSearchParams();\n`
                methodBody += `      Object.entries(queryParams).forEach(([key, value]) => {\n`
                methodBody += `        if (value !== undefined && value !== null) {\n`
                methodBody += `          searchParams.append(key, String(value));\n`
                methodBody += `        }\n`
                methodBody += `      });\n`
                methodBody += `      const queryString = searchParams.toString();\n`
                methodBody += `      if (queryString) url += '?' + queryString;\n`
                methodBody += `    }\n`
            }

            methodBody += `    return url;`

            const fullMethod = jsdoc + `  ${methodSignature} {\n${methodBody}\n  }`
            methods.push(fullMethod)
        }
    }

    clientContent += methods.join("\n\n") + "\n}\n"

    const clientFileName = fileNameOverride || `${className}.ts`
    await fs.writeFile(path.join(clientsDir, clientFileName), clientContent)
}

function extractPathParameters(pathTemplate: string): string[] {
    const matches = pathTemplate.match(/\{([^}]+)\}/g)
    return matches ? matches.map((match) => match.slice(1, -1)) : []
}

function extractQueryParameters(operation: any): string[] {
    const parameters = operation.parameters || []
    return parameters.filter((param: any) => param.in === "query").map((param: any) => param.name)
}

function generateOperationId(method: string, path: string): string {
    const cleanPath = path.replace(/\{[^}]+\}/g, "By").replace(/[^a-zA-Z0-9]/g, "")
    return cleanPath // 🔹 MODIFICATION: Retourner seulement le path nettoyé sans le verbe HTTP
}

function camelCase(str: string): string {
    return (
        str.charAt(0).toLowerCase() +
        str
            .slice(1)
            .replace(/[-_\s]+(.)/g, (_, char) => char.toUpperCase())
            .replace(/[^a-zA-Z0-9]/g, "")
    )
}

function pascalCase(str: string): string {
    const camelCased = camelCase(str)
    return camelCased.charAt(0).toUpperCase() + camelCased.slice(1)
}
