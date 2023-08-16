const core = require('@actions/core');
const github = require('@actions/github');
const stringify = require('json-stable-stringify')
const Airtable = require('airtable')
const { Octokit } = require('@octokit/rest')

require('dotenv').config()

const config = {
  tables: process.env.TABLES.split(','),
  githubToken: process.env.G_TOKEN,
  repo: process.env.G_REPO,
  owner: process.env.G_OWNER,
  airtableToken: process.env.AIRTABLE_API_KEY,
  base: process.env.AIRTABLE_BASE_ID,
  branches: process.env.GITHUB_BRANCH ? process.env.GITHUB_BRANCH.split(',') : ['master'],
  filename: process.env.FILENAME || 'data.json'
}

const CREATE_MESSAGE = 'Create dump'
const UPDATE_MESSAGE = 'Update dump (if something has changed)'

const octokit = new Octokit({
  auth: config.githubToken
})

const base = new Airtable({apiKey: config.airtableToken}).base(config.base)

const tasks = config.tables.map(tableName => {
  return new Promise((resolve, reject) => {
    const data = []

    base(tableName).select().eachPage(page, done)

    function page (records, next) {
      // This function will get called for each page of records.
      for (const record of records) {
        data.push({
          ...record._rawJson.fields,
          airtableId: record._rawJson.id
        })
      }
      next()
    }

    function done (err) {
      if (err) reject(err)
      resolve({table: tableName, data})
    }
  })
})

Promise.all(tasks).then(results => results.reduce((tables, result) => {
  tables[result.table] = result.data
  return tables
}, {})).catch(err => console.error(err)).then(tables => {
  // Use json-stable-stringify to ensure the JSON to be the same, even if the order has changed
  const json = stringify(tables, { space: 2})
  return updateOrCreate(json)
}).then(() => {
  console.log(`Successful. See https://github.com/${config.owner}/${config.repo}/`)
}).catch(err => { console.error('Error during Airtable dump to Github', err) })

const updateOrCreate = (text) => octokit.repos.getContent({
  owner: config.owner,
  repo: config.repo,
  path: config.filename
}).catch(err => {
  if (err.status !== 404) {
    throw new Error(err)
  } // else: it's ok
}).then(result => {
  const createParams = {
    owner: config.owner,
    repo: config.repo,
    path: config.filename,
    message: CREATE_MESSAGE,
    content: Buffer.from(text, 'utf-8').toString('base64')
  }
  const updateParams = (result && result.data && result.data.sha) ?
    {sha: result.data.sha, message: UPDATE_MESSAGE} : {}

  return octokit.repos.createOrUpdateFileContents({...createParams, ...updateParams})
})
