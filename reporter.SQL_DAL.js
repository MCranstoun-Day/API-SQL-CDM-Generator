const fs = require('fs');
const path = require('path');

let outputDir = process.cwd(); // Default to current working directory

function toPascalCase(str) {
    return str
        .replace(/(^\w|_\w)/g, m => m.replace('_', '').toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
}

function toSingular(word) {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('ses')) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

function jsTypeToCSharp(type, value) {
    if (type === 'string') return 'string';
    if (type === 'number') return Number.isInteger(value) ? 'int' : 'double';
    if (type === 'boolean') return 'bool';
    if (type === 'object') return Array.isArray(value) ? 'List<object>' : 'object';
    return 'object';
}

function mergeSchemas(existing, incoming) {
    const merged = { ...existing };
    for (const key of Object.keys(incoming)) {
        if (merged[key] === undefined) {
            merged[key] = incoming[key];
        } else if (
            typeof merged[key] === 'object' &&
            merged[key] !== null &&
            typeof incoming[key] === 'object' &&
            incoming[key] !== null &&
            !Array.isArray(merged[key]) &&
            !Array.isArray(incoming[key])
        ) {
            merged[key] = mergeSchemas(merged[key], incoming[key]);
        } else if (Array.isArray(merged[key]) && Array.isArray(incoming[key])) {
            const repA = getComprehensiveRepresentativeObject(merged[key]);
            const repB = getComprehensiveRepresentativeObject(incoming[key]);
            merged[key] = [mergeSchemas(repA, repB)];
        } else if (merged[key] === null && incoming[key] !== null) {
            merged[key] = incoming[key];
        }
    }
    return merged;
}

function mergeObjectKeys(arr) {
    return arr.reduce((acc, obj) => {
        if (typeof obj === 'object' && obj !== null) {
            Object.keys(obj).forEach(k => acc.add(k));
        }
        return acc;
    }, new Set());
}

function getComprehensiveRepresentativeObject(arr) {
    const keys = mergeObjectKeys(arr);
    const rep = {};
    keys.forEach(k => {
        let valueSample = undefined;
        for (const obj of arr) {
            if (obj && typeof obj === 'object' && obj.hasOwnProperty(k)) {
                valueSample = obj[k];
                break;
            }
        }
        rep[k] = valueSample === undefined ? null : valueSample;
    });
    return rep;
}

// Recursively collect nested class definitions, one per property name
function generateCSharpModel(modelName, obj, nestedClasses = {}, parentNames = new Set()) {
    let props = '';
    let hasId = false;
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const pascalKey = toPascalCase(key);
        if (pascalKey.toLowerCase() === 'id') hasId = true;

        if (Array.isArray(value)) {
            let elemType = 'object';
            if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
                const singular = toPascalCase(toSingular(key));
                const nestedModelName = singular;
                const repObj = getComprehensiveRepresentativeObject(value);
                updateSchemaAndModel(nestedModelName, repObj);
                elemType = nestedModelName;
            } else if (value.length > 0) {
                elemType = jsTypeToCSharp(typeof value[0], value[0]);
            }
            props += `    public List<${elemType}> ${pascalKey} { get; set; } = new List<${elemType}>();\n`;
        } else if (typeof value === 'object' && value !== null) {
            const nestedModelName = toPascalCase(key);
            updateSchemaAndModel(nestedModelName, value);
            props += `    public ${nestedModelName}? ${pascalKey} { get; set; }\n`;
        } else {
            // Use [Required] for non-nullable types (except for string, which is nullable by default in EF)
            let typeStr = jsTypeToCSharp(typeof value, value);
            let requiredAttr = (typeStr !== 'string' && value !== null) ? '    [Required]\n' : '';
            props += `${requiredAttr}    public ${typeStr}${(value === null && typeStr !== 'string') ? '?' : ''} ${pascalKey} { get; set; }\n`;
        }
    }
    // Add Id property if not present (EF convention)
    if (!hasId) {
        props = `    [Key]\n    public int Id { get; set; }\n` + props;
    }
    return `public class ${modelName}\n{\n${props}}\n`;
}

function updateSchemaAndModel(modelName, obj) {
    // Use outputDir instead of process.cwd()
    const schemaFilePath = path.join(outputDir, `${modelName}.schema.json`);
    let schemaObj = obj;
    if (fs.existsSync(schemaFilePath)) {
        try {
            const existingSchema = JSON.parse(fs.readFileSync(schemaFilePath, 'utf8'));
            schemaObj = mergeSchemas(existingSchema, obj);
        } catch {
            // fallback: use new schema
        }
    }
    fs.writeFileSync(schemaFilePath, JSON.stringify(schemaObj, null, 2), 'utf8');

    // Generate C# model
    const nestedClasses = {};
    const parentNames = new Set();
    const classCode = generateCSharpModel(modelName, schemaObj, nestedClasses, parentNames);

    const fileContent = `using System.ComponentModel.DataAnnotations;\nusing System.ComponentModel.DataAnnotations.Schema;\nusing System.Collections.Generic;\n\n${classCode}\n`;
    fs.writeFileSync(
        path.join(outputDir, `${modelName}.cs`),
        fileContent,
        'utf8'
    );
    // Recursively update nested models
    for (const [nestedName, nestedClass] of Object.entries(nestedClasses)) {
        const nestedSchemaObj = schemaObj[nestedName] || {};
        updateSchemaAndModel(nestedName, nestedSchemaObj);
    }
}

function buildFullModelFilesUniversal(rootObj) {
    if (
        typeof rootObj === 'object' &&
        rootObj !== null &&
        !Array.isArray(rootObj)
    ) {
        for (const key of Object.keys(rootObj)) {
            const modelName = toPascalCase(key);
            let obj = rootObj[key];
            if (Array.isArray(obj)) {
                obj = getComprehensiveRepresentativeObject(obj);
            }
            updateSchemaAndModel(modelName, obj);
        }
    }
}

function NewmanSaveResponsesReporter(emitter, reporterOptions, collectionRunOptions) {
    // Set outputDir from reporter options, fallback to process.cwd()
    outputDir = reporterOptions.outputDir || process.cwd();
    // Ensure outputDir exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    emitter.on('request', function (err, args) {
        if (err) return;
        const response = args.response;
        let body;
        try {
            body = response.stream ? response.stream.toString() : '';
            if (response.headers.get('content-type')?.includes('application/json')) {
                body = JSON.parse(body);
            }
        } catch (e) {
            body = response.stream?.toString() || '';
        }
        if (typeof body === 'object' && body !== null) {
            buildFullModelFilesUniversal(body);
        }
    });
}

module.exports = NewmanSaveResponsesReporter;
