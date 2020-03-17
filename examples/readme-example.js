// this file is run with the electron binary
const electron = require( 'electron' )
const eleko = require( '../index.js' )

// Module to control application life
const app = electron.app
// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

app.on( 'ready', main )

let page
async function main () {
  page = await eleko.newPage()

  // page.win is an instance of BrowserWindow that is updated
  // every time page.goto is called.

  // block ads using a subset of easylist
  eleko.onrequest( page.win, function ( req ) {
      const url = req.url
      const shouldBlock = containsAds( url )
      if ( shouldBlock ) {
        console.log( '(x) blocked url: ' + url.slice( 0, 45 ) )
        return req.abort()
      }
      return req.continue()
  } )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await page.goto( url )

  // waitFor string
  await eleko.waitFor( page.win, 'video' )

  // evaluate
  await eleko.evaluate( page.win, function () {
    const video = document.querySelector( 'video' )

    video.pause()

    video._play = video.play // keep reference to original
    video.play = function () {} // remove .play so that YouTube's scripts can't play it automatically
  } )

  // get title
  const title = await eleko.evaluate( page.win, function () {
    return document.title
  } )
  console.log( 'title: ' + title )

  // waitFor function
  await eleko.waitFor( page.win, function () {
    const el = document.querySelector( 'video' )
    // wait until we can play video
    return el && el.readyState === 4 // HAVE_ENOUGH_DATA
  } )

  // evaluate with args ( play video )
  await eleko.evaluate( page.win, function ( selector, data ) {
    const el = document.querySelector( selector )

    // call the original play function
    el[ data.function_name ]()
  }, 'video', { function_name: '_play' } )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await eleko.evaluate( page.win, function () {
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
}

function containsAds ( url ) {
  return adBlockClient.matches( url )
}

const fs = require( 'fs' )
const path = require( 'path' )
const adBlockClient = require( 'ad-block-js' ).create()
fs.readFileSync(
  path.join( __dirname, '../easylist.txt' ), 'utf8'
)
.split( /\r?\n/ )
.forEach( function ( rule ) {
  adBlockClient.add( rule )
} )
