const electron = require( 'electron' )
const eleko = require( '../index.js' )

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

const assert = require( 'assert' )

const adBlockClient = require( 'ad-block-js' ).create()
fs.readFileSync(
  path.join( __dirname, '../easylist.txt' ), 'utf8'
)
.split( /\r?\n/ )
.forEach( function ( rule ) {
  adBlockClient.add( rule )
} )

function containsAds ( url ) {
  console.log( 'calling containsAds' )
  return adBlockClient.matches( url )
}

// bit of a hacky way to expose function we will use in
// onBeforeRequest callback
module.exports.containsAds = containsAds

if ( require.main === module ) {
  main()
}

async function main ()
{
  const browser = await eleko.launch()
  const page = await browser.newPage()

  const userAgent = await page.call( 'webContents.session.getUserAgent' )

  // assert.equal( userAgent, ( await page.getUserAgent() ) )
  console.log( 'userAgent: ' + userAgent )

  // bit of a hacky way to define the onBeforeRequest callback
  // outside of the elecron
  const _onBeforeRequestFilename = path.resolve( __filename )
  console.log( _onBeforeRequestFilename )

  const onBeforeRequest = eval(`
    ;( function () {
      return function onBeforeRequest ( details, callback ) {
        let url = details.url
        console.log( 'filename: ' + "${ _onBeforeRequestFilename }" )

        const containsAds = require( "${ _onBeforeRequestFilename }" ).containsAds

        const shouldBlock = (
          containsAds( url )
        )

        if ( shouldBlock ) {
          console.log( ' (x) ad blocked: ' + url.slice( 0, 23 ) )
          callback( { cancel: true } ) // block
        } else {
          callback( { cancel: false } ) // let through
        }
      }
    } )()
    `)

  // cancel or do something before requests
  await page.call(
    'webContents.session.webRequest.onBeforeRequest',
    onBeforeRequest
  )

  console.log( ' == GIRAFFE == ' )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await page.call( 'loadURL', url )

  console.log( ' == PAGE LOADED == ' )

  const now = Date.now()
  // waitFor
  await page.call(
    'webContents.executeJavaScript',
    `
    ;( function () {
      return new Promise( function ( resolve ) {
        tick()
        function tick () {
          console.log( '=== WAITFOR TICK === ' )

          const v = document.querySelector( 'video' )
          if ( v ) {
            v.pause()

            // hide play fn so that YouTube's own scripts won't
            // auto play the video
            if ( !v._play ) {
              v._play = v.play
              v.play = function () {}
            }

            // wait until page can be played
            if ( v.readyState === 4 ) return resolve() // HAVE_ENOUGH_DATA
          }

          setTimeout( tick, 250 )
        }
      } )
    } )()
    `
  )

  await page.waitFor( function () {
    return document.title.toLowerCase() !== 'youtube'
  } )

  const title = await page.call(
    'webContents.executeJavaScript',
    `
    ;( function ( title ) {
      return document[ title ]
    } )( ${ 'title' })
    `
  )

  console.log( 'title: ' + title )

  // play video
  await page.call(
    'webContents.executeJavaScript',
    `
    ;( function ( title ) {
      document.querySelector( 'video' )._play()
    } )()
    `
  )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await page.call(
      'webContents.executeJavaScript',
      `
      ;( function () {
        const video = document.querySelector( 'video' )
        return {
          currentTime: video.currentTime,
          duration: video.duration
        }
      } )()
      `
    )

    if ( time ) {
      console.log( `${ time.currentTime } / ${ time.duration }` )
    }

    setTimeout( tick, 1000 )
  }
}
