module.exports = {
    generateDocs: function (docJson) {
        return `
        <style>${style}</style>
        <h1>${docJson.name}</h1>
        ${generateContent(docJson)}
        `
    }
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
function generateContent(docJson) {
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
                ${Object.entries(m).filter(([key, value]) => !keyBlacklist.some(k => k == key)).reduce((prev,[paramName, paramData]) => 
                    prev + `
                    <b class="param-name">${paramName}: <i>${paramData.type}</i></b><br>
                    <i class="param-desc">${paramData.desc}</i><br>
                    <b class="valid-values">valid values:</b>
                    ${paramData.values.reduce((prev, curr) => `${prev}<br>${curr}`, "")}
                    <br><br>`
                ,"")}
                Examples:<br>
                ${
                    m.examples.reduce((prev, curr) => {
                        const url = `${docJson.path}${fillTemplate(m.path, curr)}`
                        return `${prev}<br><a href="${url}">${url}</a>`
                    },"")
                }
                <hr>
                `
            })
            break;
        case "listing":
            content += `
            <h2>Endpoints:</h2>
            ${docJson.endpoints.reduce((prev, {path, desc}) => {
                const url = `${docJson.path}${path}`
                return `${prev}<br><a href="${url}">${url}</a> ${parseAnchors(desc)}`
            }, "")}`
            break;
        default:
            break;
    }
    return content;
}
function fillTemplate(template, values) {
  return template.replace(/{(.*?)}/g, (_, key) => values[key] ?? `{${key}}`);
}
function parseAnchors(str) {
  return str.replace(/!a\((https?:\/\/[^\s)]+)\)/g, (_, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}