// test a usage case of playing youtube video

const test = require( 'tape' )
const eleko = require( '../index.js' )

// dump active handles
const wtfnode = require( 'wtfnode' )

test( 'play youtube video', async function ( t ) {
  t.timeoutAfter( 1000 * 15 )
  t.plan( 3 )

  const browser = await eleko.launch()
  const page = await browser.newPage()

  page.on( 'request', function ( req ) {
    const url = req.url
    const resourceType = req.resourceType

    let shouldBlock = (
      resourceType === 'image' ||
      containsAds( url )
    )

    if ( resourceType === 'other' ) {
      // block fonts and stuff
      shouldBlock = true
    }

    if ( resourceType === 'script' ) {
      if ( url.indexOf( 'base.js' ) === -1 ) {
        // block unnecessary scripts
        shouldBlock = true
      }
    }

    if ( shouldBlock ) {
      console.log( '(x) blocked url: ' + url.slice( 0, 45 ) )
      return req.abort()
    }

    // console.log( 'url: ' + url.slice( 0, 45 ) )
    req.continue()
  } )

  // youtube video that requries h264 codec ( default chromium
  // can't play )
  await page.goto( 'https://www.youtube.com/watch?v=pFbkURxNKPE' )
  await page.waitFor( function () {
    const video = document.querySelector( 'video' )

    if ( video ) {
      video.pause()
      if ( !video._play ) {
        // hide play function from YouTube's internal scripts
        // so that it doesn't autoplay
        video._play = video.play
        video.play = function () {}
      }

      if ( video.readyState === 4 ) { // HAVE_ENOUGH_DATA
        video._play()
        return true
      }
    }

    return false // not ready yet
  } )

  await new Promise( function ( r ) { setTimeout( r, 2000 ) } )

  checkTime()
  async function checkTime () {
    const time = await page.evaluate( function () {
      const video = document.querySelector( 'video' )
      return {
        currentTime: video.currentTime,
        duration: video.duration
      }
    } )

    console.log( time )

    if ( time.currentTime > 1 ) {
      finish( time )
    } else {
      setTimeout( checkTime, 1000 )
    }
  }

  async function finish ( time ) {
    t.ok( time.currentTime > 1, 'currentTime ok' )
    t.equal( time.duration | 0, 1051, 'duration ok' )

    await browser.close()
    t.pass( 'browser closed' )
  }
} )

test.onFinish( function () {
  console.log( 'on finish' )
  wtfnode.dump()
} )

const adBlockClient = require( 'ad-block-js' ).create()
require( 'fs' ).readFileSync(
  require( 'path' ).join( __dirname, '../easylist.txt' ), 'utf8'
)
.split( /\r?\n/ )
.forEach( function ( rule ) {
  adBlockClient.add( rule )
} )

function containsAds ( url ) {
  return adBlockClient.matches( url )
}

