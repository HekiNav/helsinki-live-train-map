export interface DocJson {
    name: string,
    path: string,
}
export interface DocJsonListing extends DocJson {
    type: "listing",
    endpoints: DocEndpoint[]
}
export interface DocJsonEndpoint extends DocJson {
    type: "docs",
    methods: DocMethod[]
}
export type AnyDocJson = DocJsonEndpoint | DocJsonListing
export type DocEndpoint = {
    path: string;
    desc: string;
};

export type DocMethod<T extends Record<string, DocEndpointParam> = {}> = {
    path: string;
    desc: string;
    examples: Partial<{ [K in keyof T]: T[K] }>[];
} & { [K in keyof T]: T[K] };

export interface DocEndpointParam {
    type: string,
    desc: string,
    values: string[]
}
export function generateDocs(docJson: AnyDocJson) {
    return `
        <style>${style}</style>
        <h1>${docJson.name}</h1>
        ${generateContent(docJson)}
        `
}

const style = `
body {
    font-family: 'Trebuchet MS', 'Lucida Sans Unicode', 'Lucida Grande', 'Lucida Sans', Arial, sans-serif;
    background-color: #fff;
    color: #002;
}
.param-desc {
    font-size: .8em;
}
`
function generateContent(docJson: AnyDocJson) {
    const keyBlacklist = [
        "path",
        "examples",
        "desc"
    ]
    let content = ""
    switch (docJson.type) {
        case "docs":
            content += "<h2>Methods:</h2>"
            docJson.methods.forEach(m => {
                content += `
                <h3 class="method">${m.path}</h3>
                ${m.desc}<br>
                <br>
                ${Object.entries(m).filter(([key, value]) => !keyBlacklist.some(k => k == key)).reduce((prev, [paramName, paramData]) => {
                    const param = paramData as never as DocEndpointParam
                    return prev + `
                    <b class="param-name">${paramName}: <i>${param.type}</i></b><br>
                    <i class="param-desc">${param.desc}</i><br>
                    <b class="valid-values">valid values:</b>
                    ${param.values.reduce((prev, curr) => `${prev}<br>${curr}`, "")}
                    <br><br>`
                }, "")}
                Examples:<br>
                ${m.examples.reduce((prev, curr) => {
                    const url = `${docJson.path}${fillTemplate(m.path, curr)}`
                    return `${prev}<br><a href="${url}">${url}</a>`
                }, "")
                    }
                <hr>
                `
            })
            break;
        case "listing":
            content += `
            <h2>Endpoints:</h2>
            ${docJson.endpoints.reduce((prev, { path, desc }) => {
                const url = `${docJson.path}${path}`
                return `${prev}<br><a href="${url}">${url}</a> ${parseAnchors(desc)}`
            }, "")}`
            break;
        default:
            break;
    }
    return content;
}
function fillTemplate(template: string, values: Record<string, string>) {
    return template.replace(/{(.*?)}/g, (_, key) => values[key] ?? `{${key}}`);
}
function parseAnchors(str: string) {
    return str.replace(/!a\((https?:\/\/[^\s)]+)\)/g, (_, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}