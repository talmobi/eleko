// this file is run with the electron binary
const electron = require( 'electron' )
const eleko = require( '../index.js' )

const app = electron.app

const adBlockClient = require( 'ad-block-js' ).create()
fs.readFileSync(
  path.join( __dirname, '../easylist.txt' ), 'utf8'
)
.split( /\r?\n/ )
.forEach( function ( rule ) {
  adBlockClient.add( rule )
} )

function containsAds ( url ) {
  console.log( 'calling containsAds: ' + url.slice( 0, 55 ) )
  return adBlockClient.matches( url )
}

let mainWindow
;(async function () {
  // launch BrowserWindow with eleko.getDefaultOptions()
  mainWindow = await eleko.launch( electron )

  // block ads using a subset of easylist
  mainWindow.session.webRequest.onBeforeRequest(
    function ( details, callback ) {
      const url = details.url
      const shouldBlock = containsAds( url )
      if ( shouldBlock ) return callback( { cancel: true })
      return callback( { cancel: false })
    }
  )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await eleko.goto( mainWindow, url )

  // waitFor string
  await eleko.waitFor( mainWindow, 'video' )

  // evaluate
  await eleko.evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )

    video.pause()

    video._play = video.play // keep reference to original
    video.play = function () {} // remove .play so that YouTube's scripts can't play it automatically
  } )

  // get title
  const title = await eleko.evaluate( mainWindow, function () {
    return document.title
  } )
  console.log( 'title: ' + title )

  // evaluate with args ( play video )
  await eleko.evaluate( mainWindow, function ( selector, data ) {
    const el = document.querySelector( selector )

    // call the original play function
    el[ data.function_name ]()
  }, 'video', { function_name: '_play' } )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await eleko.evaluate( mainWindow, function () {
      const video = document.querySelector( 'video' )
      return {
        currentTime: video.currentTime,
        duration: video.duration
      }
    } )

    if ( time ) {
      console.log( `${ time.currentTime } / ${ time.duration }` )
    }

    setTimeout( tick, 1000 )
  }
} )()
