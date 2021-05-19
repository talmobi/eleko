const eleko = require('eleko')
const nfzf = require('node-fzf')
const yts = require('yt-search')

const list = [
  'https://www.youtube.com/watch?v=ZRBuEy1Jvb0',
  'https://www.youtube.com/watch?v=Wkof3nPK--Y',
  'https://www.youtube.com/watch?v=mBRnh0tkQtU',
]

main()

let eleSpawn = undefined

async function main () {
  const { selected, query } = nfzf.getInput('search youtube: ')
  const searchTerm = query

  if (!searchTerm) {
    console.log('No query given. Exiting.')
    process.exit()
  } else {
    const r = await yts(searchTerm)
    const opts = {
      list: r.videos.map(v => v.url),
      mode: 'normal',
      // TODO
    }
    const { selected, query } = await nfzf(opts)

    // TODO get url based on index?
    const url = r.videos[ selected.index ]

    const spawn = eleko.spawn('./ele-test.js')

    // TODO tell spawn somehow
    spawn.tell( url )
  }
}
