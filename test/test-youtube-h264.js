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

  await page.setAudioMuted( true )

  tick()
  async function tick () {
    const TICK_INTERVAL_MS = 333

    const r = await page.evaluate( function ( TICK_INTERVAL_MS ) {
      console.log( 'TICK_INTERVAL_MS: ' + TICK_INTERVAL_MS )
      const state = window.__state || 'start'
      if ( !window.__startTime ) window.__startTime = Date.now()
      const delta = ( Date.now() - window.__startTime )

      const video = document.querySelector( 'video' )
      const html5VideoPlayer = document.querySelector('.html5-video-player')

      function videoIsPlaying ( videoEl ) {
        return (
          videoEl && videoEl.currentTime > 0 && !videoEl.paused && !videoEl.ended
        )
      }

      console.log( 'state: ' + state )
      switch ( state ) {
        case 'start':
          if ( video && html5VideoPlayer ) {
            window.__state = 'check-ads'
          }
          break;

        case 'check-ads':
          if ( html5VideoPlayer ) {
            // detect ads
            if (
              html5VideoPlayer.classList.contains( 'ad-showing' ) ||
              html5VideoPlayer.classList.contains( 'ad-interrupting' )
            ) {
              delete window.__no_ads_time
              // ads are playing
              console.log( ' >> ads detected << ' )
              if ( videoIsPlaying( video ) ) {
                console.log( ' -> forwarding ad currentTime -> ' )
                video.currentTime = ( video.duration - TICK_INTERVAL_MS / 1000 )
              }
            } else {
              console.log( 'no ads detected...' )
              if ( !window.__no_ads_time ) {
                window.__no_ads_time = Date.now()
              }
              const d = ( Date.now() - window.__no_ads_time )
              if ( d > TICK_INTERVAL_MS ) {
                console.log( '...ads stopped' )
                window.__state = 'ads-stopped'
              }
            }
          } else {
            console.log( 'error: no html5VideoPlayer found' )
          }
          break;

        case 'ads-stopped':
          // reset the current video and play it
          if ( video ) {
            video.pause()
            video.currentTime = window.__lastCurrentTime || 0
            video.muted = true
            video.volume = 0
            window.__state = 'play'
            return 'unmute'
          } else {
            console.log( 'error: no html5VideoPlayer found' )
          }
          break;

        case 'play':
          if ( video ) {
            video.muted = false
            video.volume = 1
            video.loop = false
            video.play()
            window.__state = 'playing'
          } else {
            console.log( 'error: no video found' )
          }
          break;

        case 'playing':
          // detect ads
          if ( html5VideoPlayer ) {
            if (
              html5VideoPlayer.classList.contains( 'ad-showing' ) ||
              html5VideoPlayer.classList.contains( 'ad-interrupting' )
            ) {
              // ads detected
              console.log( ' >>> ADS DETECTED DURING PLAY <<< ' )
              // TODO goto secondary ads clearing state
              window.__state = 'check-ads'
            } else {
              if ( video.currentTime > ( window.__lastCurrentTime || 0 ) ) {
                window.__lastCurrentTime = video.currentTime
              }
              if (
                video.currentTime > 0 && !video.ended && video.currentTime >= window.__lastCurrentTime
              ) {
                // keep playing video in case it's interrupted?
                return {
                  currentTime: video.currentTime,
                  duration: video.duration,
                }
              } else {
                console.log( 'video ended?' )
                video.pause()
              }
            }
          }
          break;
      }

      return undefined
    }, TICK_INTERVAL_MS )

    console.log( r )
    if ( r === 'unmute' ) {
      await page.setAudioMuted( false )
    }

    if ( r?.currentTime > 1) {
      finish( r )
    } else {
      setTimeout( tick, TICK_INTERVAL_MS )
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

