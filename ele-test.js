const { app, BrowserWindow } = require('electron')

app.disableHardwareAcceleration()

// TODO
// revamp eleko.spawn (from node), eleko.init (from electron)

// hide dock icon by default
// app.dock && app.dock.hide && app.dock.hide()

// .video-ads .ytp-ad-module

const eleko = require('./index.js')

const fs = require( 'fs' )
const path = require('path')

// track windows -> destroy previous when creating new
const windows = []

// const nfzf = require('node-fzf')

const abjs = require( 'ad-block-js' )
const adBlockClient = abjs.create()

function debug ( ...args ) {
  console.log.apply( this, args )
}

function log ( level, message ) {
}

// used to block ad urls
const easyList = fs.readFileSync(
  path.join( __dirname, 'easylist.txt' ), 'utf8'
).split( '\n' ).map( function ( t ) {
  return t.replace( /[\r\n]/g, '' )
} )

for ( let i = 0; i < easyList.length; i++ ) {
  const rule = ( easyList[ i ] || '' ).trim()
  if ( rule ) {
    adBlockClient.add( rule )
  }
}

function containsAds ( url )
{
  return adBlockClient.matches( url )
}

const list = [
  'https://www.youtube.com/watch?v=ZRBuEy1Jvb0',
  'https://www.youtube.com/watch?v=Wkof3nPK--Y',
  'https://www.youtube.com/watch?v=mBRnh0tkQtU',
]

let electronReadyResolve, electronReadyReject
const electronReadyPromise = new Promise( function ( resolve, reject ) {
  electronReadyResolve = resolve
  electronReadyReject = reject
} )

function play ( url ) {
  createWindow( url )
}

run()

// TODO DEPRECATED
async function run () {
  const nfzf = require('node-fzf')

  const opts = {
    list: list,
    mode: 'normal'
  }
  const result = await nfzf( opts )

  const { selected, query } = result

  await electronReadyPromise

  if ( !selected ) {
    console.log( 'no matches for query: ' + query )
  } else {
    console.log( 'selected: ' + selected.value )
    createWindow( selected.value )
  }
}

// parse env variables
const _envs = {}
Object.keys( process.env ).forEach(
  function ( key ) {
    const n = process.env[ key ]
    if ( n == '0' || n == 'false' || !n ) {
      return _envs[ key ] = false
    }
    _envs[ key ] = n
  }
)

const DEFAULT_OPTS = {
  show: !!( _envs.show || _envs.debug ),

  width: 800,
  height: 600,
  webPreferences: {
    autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 0 ],

    // javascript: false,
    images: false,
    webgl: false,

    nodeIntegration: false,
    webviewTag: false,
    contextIsolation: true,
    enableRemoteModule: false,

    // preload: path.join( __dirname, 'electron-preload.js' )
    preload: undefined
  }
}

const DEFAULT_USERAGENT = 'Mozilla/5.0 (https://github.com/talmobi/eleko)'

async function createWindow ( url ) {
  const win = new BrowserWindow( DEFAULT_OPTS )

  const prevWindow = windows.pop()
  if ( prevWindow ) {
    prevWindow.destroy()
  }
  windows.push( win )

  const session = win.webContents.session

  log( 1, 'prime:clearingStorageData' )
  await session.clearStorageData()
  log( 1, 'prime:clearingStorageData done' )

  log( 1, 'prime:win:userAgent' )
  await session.setUserAgent( DEFAULT_USERAGENT )

  await session.cookies.set( {
    url: 'https://consent.youtube.com',
    name: 'CONSENT',
    value: 'YES+',
    domain: '.youtube.com',
    expirationDate: Math.floor( Date.now() / 1000 ) + 3600 * 999,
  } )

  eleko.onrequest( win, function ( req ) {
    const url = req.url
    const resourceType = req.resourceType

    if ( resourceType === 'image' ) {
      // block images
      debug( 'image blocked: ' + url.slice( 0, 55 ) )
      return req.abort()
    }

    if ( containsAds( url ) ) {
      // block ads
      debug( 'ad blocked: ' + url.slice( 0, 55 ) )
      return req.abort()
    }

    if ( resourceType === 'other' ) {
      // block fonts and stuff
      debug( 'other blocked: ' + url.slice( 0, 55 ) )
      return req.abort()
    }

    if ( resourceType === 'script' ) {
      if ( url.indexOf( 'base.js' ) === -1 ) {
        // block unnecessary scripts
        debug( 'script blocked: ' + url.slice( 0, 55 ) )
        return req.abort()
      }
    }

    debug( 'url passed: ' + url.slice( 0, 55 ) )
    req.continue()
  } )

  // mute audio to prevent perhaps small ads from loading and playing
  // sound before the video
  win.webContents.setAudioMuted(true)

  // win.loadFile('index.html')
  await win.loadURL( url )

  // win.openDevTools()

  // skip ads ASAP
  eleko.evaluate(
    win,
    function () {
      return new Promise ( function ( resolve, reject ) {
        let interval = setInterval( function () {
          const btn = document.querySelector( '.ytp-ad-skip-button' )
          if ( btn ) {
            clearInterval( interval )
            btn.click()

            // btn.style.background = 'red'
            // btn.style.color = 'black'
            // setTimeout( function () {
            //   resolve()
            //   btn.click()
            // }, 2000 )
          }
        }, 1000 )
      } )
    },
  )


  // wait until video present
  await eleko.evaluate(
    win,
    function () {
      return new Promise ( function ( resolve, reject ) {
        let interval = setInterval( function () {
          const video = document.querySelector( 'video' )

          if ( video ) {
            window.wideo = video

            // hide api from internal scripts
            video._pause = video.pause
            video._play = video.play
            video.play = function () {}
            video.pause = function () {}

            if ( video.currentTime > 0 && video.duration > 0 ) {
              video._pause()
              video.currentTime = 0
              clearInterval( interval )
              resolve()
            }
          }
        }, 300 )
      } )
    },
  )

  // wait/remove persistent ads
  await eleko.evaluate(
    win,
    function () {
      return new Promise ( function ( resolve, reject ) {
        const interval = setInterval( function () {
          const ads = document.querySelector( '.video-ads' )
          const childCount = ads.childElementCount

          const video = window.wideo
          if ( !video ) return

          if ( childCount != 0 ) {
            // is an ad
            // video.currentTime = Math.floor( video.duration ) - 1
            // video._play()
            video.currentTime = video.duration
          } else {
            // OK!
            clearInterval( interval )
            return resolve()
          }

          resolve()
        }, 1000 )
      } )
    },
  )

  // unmute electron
  win.webContents.setAudioMuted(false)

  await eleko.evaluate(
    win,
    function () {
      return new Promise ( function ( resolve, reject ) {
        tick()
        function tick () {
          const v = window.wideo
          if ( v && v.readyState === 4 ) { // HAVE_ENOUGH_DATA
            v._play()
            resolve()
          } else {
            setTimeout( tick, 500 )
          }
        }
      } )
    },
  )

  console.log( 'done' )
}

app.whenReady().then(() => {
  electronReadyResolve()
  // createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

