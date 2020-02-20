const eleko = require( '../index.js' )

;( async function () {
  const browser = await eleko.launch( { show: true } )
  const page = await browser.newPage()

  page.on( 'request', function ( req ) {
    const url = req.url
    const resourceType = req.resourceType

    const shouldBlock = (
      resourceType === 'image' ||
      containsAds( url )
    )

    if ( shouldBlock ) {
      console.log( '(x) blocked url: ' + url.slice( 0, 45 ) )
      return req.abort()
    }

    req.continue()
  } )

  await page.goto( 'https://www.youtube.com/watch?v=WY6sR6HQuMw' )
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
} )()

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
