// tests the launch api and its small subet of helper fn's
// page.on( 'request', function ( req ) { ... } )
// or
// page.onrequest = function ( req ) { ... }
//
// page.goto( ... )
// page.waitFor( <String>querySelector or <Function>evaluate )
// page.evaluate
//
// page.setUserAgent( userAgent )
// page.getUserAgent()

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

main()

async function main ()
{
  const browser = await eleko.launch()
  const page = await browser.newPage()

  const userAgent = await page.call( 'webContents.session.getUserAgent' )

  // assert.equal( userAgent, ( await page.getUserAgent() ) )
  console.log( 'userAgent: ' + userAgent )

  // cancel or do something before requests
  page.on( 'request', function ( req ) {
    const url = req.url
    const resourceType = req.resourceType

    const shouldBlock = (
      resourceType === 'image' ||
      containsAds( url )
    )

    console.log( 'url: ' + url )
    console.log( 'contains ads: ' + containsAds( url ) )

    if ( shouldBlock ) return req.abort()
    req.continue()
  } )

  console.log( ' == GIRAFFE == ' )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await page.goto( url )

  console.log( ' == PAGE LOADED == ' )

  const now = Date.now()
  await page.waitFor( 'video' )

  await page.waitFor( function () {
    return document.title.toLowerCase() !== 'youtube'
  } )

  const title = await page.evaluate(
    function ( selector ) {
      return document[ selector ]
    },
    'title'
  )

  console.log( 'title: ' + title )
  console.log( 'waited for: ' + ( Date.now() - now ) )

  await page.waitFor(
    function () {
      const v = document.querySelector( 'video' )
      if ( v ) {
        v.pause()

        // hide play fn so that YouTube's own scripts won't
        // auto play the video
        if ( !v._play ) {
          v._play = v.play
          v.play = function () {}
        }
      }
      // wait until page can be played
      return v && v.readyState === 4 // HAVE_ENOUGH_DATA
    }
  )

  await page.evaluate(
    function () {
      const v = document.querySelector( 'video' )
      v._play()
    }
  )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await page.evaluate( function () {
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
