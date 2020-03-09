// this file should be run with electron binary
// ex. node_modules/.bin/electron electron-main.js

const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )

// Module to control application life
const app = electron.app

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )
  console.log( error )

  try {
    console.log( 'exit electron: uncaughtException' )
    app.quit()
  } catch ( err ) {
    /* ignore */
  }

  process.exit( 1 )
} )

app.disableHardwareAcceleration()

// app.commandLine.appendSwitch( 'use-gl', 'swiftshader' )
// app.commandLine.appendSwitch( 'ignore-gpu-blacklist' )

// hide dock icon by default
app.dock && app.dock.hide && app.dock.hide()

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

const _pages = {}

const eleko = require( './index.js' )
const eeto = require( 'eeto' )

const stdioipc = require( './stdio-ipc.js' )

// is this needed?
let _launchOptions = {}

// create a named function out of a parse-function object
// ex. const pf = require('parse-function')().parse( function foo () {} )
//     const fn = createNamedFunction( pf )
function createNamedFunction ( pf ) {
  log( 1, 'createNamedFunction' )

  const fn = Function.apply(
    this,
    [
      `
      return function ${ pf.name || '' } ( ${ pf.args.join( ',' ) } ) {
        ${ pf.body }
      }
      `.trim()
    ]
  )
  return fn()
}

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

const verbosity = (
  _envs.debug ? 10 : Number( _envs.verbose ) || 0
)

function log ( level, message ) {
  if ( level > verbosity ) return
  console.log( message )
}

// example data
const _philipGlassHoursVideoId = 'Wkof3nPK--Y'
const pkmnBlueWaveId = 'pFbkURxNKPE' // requires h264
const creedenceId = 'Gu2pVPWGYMQ' // AV1
const _urlTemplate = 'https://www.youtube.com/watch/$videoId'
const _videoId = creedenceId

// notify launch with eleko to setup stdio ipc with env
// variable
let _appReady = false

const ipc = stdioipc.create( process.stdin, process.stdout )

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  startCheckingHeartbeats() // start checking heartbeats after ready
  ipc.emit( 'ready' )
} )

ipc.on( 'heartbeat', function () {
  startCheckingHeartbeats.lastHeartbeat = Date.now()
} )

function startCheckingHeartbeats () {
  const now = Date.now()

  // init lastHeartbeat
  if ( !startCheckingHeartbeats.lastHeartbeat ) {
    startCheckingHeartbeats.lastHeartbeat = now
  }

  const delta = now - startCheckingHeartbeats.lastHeartbeat

  if ( delta > 3000 ) {
    console.log( 'exit electron: heartbeat stopped' )
     setTimeout( function () {
      app.quit()
    }, 0 )
    return false
  }

  clearTimeout( startCheckingHeartbeats.timeout )
  startCheckingHeartbeats.timeout = setTimeout( startCheckingHeartbeats, 500 )
  return true
}

ipc.on( 'promise', function ( p ) {
  const data = p.data
  log( 1, 'promise: ' + data.type )

  function callback ( err, value ) {
    if ( callback.done ) return
    callback.done = true
    log( 1, 'promise:callback' )
    if ( err ) return p.reject( err )
    p.resolve( value )
  }

  const req = {
    callback: callback,
    data: data.content
  }

  ipc.emit( 'promise:' + data.type, req )
} )

ipc.on( 'promise:quit', function () {
  log( 1, 'exit: browser.close() called' )
  setTimeout( function () {
    app.quit()
  }, 0 )
} )

ipc.on( 'promise:newPage', async function ( req ) {
  log( 1, 'promise:newPage' )

  const options = req.data
  const page = await eleko.newPage( Object.assign(
    {
      show: !!( _envs.show || _envs.debug ),
    },
    options || {}
  ) )
  _pages[ page.id ] = page

  attachInitialOnBeforeRequestHandler( page )
  // attachInitialWillNavigateHandler( page )

  req.callback( undefined, page.id )
  log( 1, 'new page created' )
} )

ipc.on( 'promise:page:goto', async function ( req ) {
  log( 1, 'promise:page:goto' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const url = req.data.url

  attachInitialOnBeforeRequestHandler( page )
  // attachInitialWillNavigateHandler( page )

  log( 1, 'page:' )
  log( 1, page )

  try {
    log( 1, 'promise:page:goto:waiting' )
    await page.goto( url )
    log( 1, 'promise:page:goto:done' )
    req.callback( undefined )
  } catch ( err ) {
    log( 1, 'promise:page:goto:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:close', async function ( req ) {
  log( 1, 'promise:page:close' )

  log( 1, req.data )
  const page = _pages[ req.data.id ]

  try {
    log( 1, 'promise:page:close:waiting' )
    await page.close()
    log( 1, 'promise:page:close:done' )
    req.callback( undefined )
  } catch ( err ) {
    log( 1, 'promise:page:close:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:evaluate', async function ( req ) {
  log( 1, 'promise:page:evaluate' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const data = req.data

  log( 1, 'page:' )
  log( 1, page )

  if ( !page ) {
    return req.callback( 'no page found for id: ' + req.data.id )
  }

  const pf = data.pf
  const args = data.args

  log( 1, 'page:evaluate createNamedFunction' )

  const evalFn = createNamedFunction( pf )
  log( 1, 'page:evaluate createNamedFunction:done' )
  log( 1, evalFn.toString() )

  const evalArgs = args

  const applyArgs = [
    page.win,
    evalFn,
    ...args
  ]

  log( 1, 'page:evaluate args' )
  log( 1, applyArgs.slice( 2 ) )

  try {
    log( 1, 'promise:page:evaluate:waiting' )
    const value = await eleko.evaluate.apply( this, applyArgs )
    log( 1, 'promise:page:evaluate:done' )
    req.callback( undefined, value )
  } catch ( err ) {
    log( 1, 'promise:page:evaluate:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:setUserAgent', async function ( req ) {
  log( 1, 'promise:page:setUserAgent' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const data = req.data

  log( 1, 'page:' )
  log( 1, page )

  if ( !page ) {
    return req.callback( 'no page found for id: ' + req.data.id )
  }

  try {
    log( 1, 'promise:page:setUserAgent:waiting' )
    const value = eleko.setUserAgent.apply( this, [ page.win, data.userAgent ] )
    log( 1, 'promise:page:setUserAgent:done' )
    req.callback( undefined, value )
  } catch ( err ) {
    log( 1, 'promise:page:setUserAgent:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:getUserAgent', async function ( req ) {
  log( 1, 'promise:page:getUserAgent' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const data = req.data

  log( 1, 'page:' )
  log( 1, page )

  if ( !page ) {
    return req.callback( 'no page found for id: ' + req.data.id )
  }

  try {
    log( 1, 'promise:page:getUserAgent:waiting' )
    const value = eleko.getUserAgent.apply( this, [ page.win ] )
    log( 1, 'promise:page:getUserAgent:done' )
    req.callback( undefined, value )
  } catch ( err ) {
    log( 1, 'promise:page:getUserAgent:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  console.log( 'exit electron: window-all-closed' )
  setTimeout( function () {
    app.quit()
  }, 0 )
})

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // if ( mainWindow === null ) {
  //   createWindow()
  // }
})

function attachInitialOnBeforeRequestHandler ( page ) {
  if ( !page.win ) return
  if ( page.win._attachInitialOnBeforeRequestHandler ) return
  page.win._attachInitialOnBeforeRequestHandler = true

  const mainWindow = page.win
  const session = mainWindow.webContents.session

  // attach request handler
  session.webRequest.onBeforeRequest(
    async function ( details, callback ) {
      let url = details.url

      // special cases to always allow
      if ( url.indexOf( 'devtools' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if ( url.indexOf( 'about:blank' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if (
        url.indexOf( 'about' ) !== 0 &&
        url.indexOf( 'chrome' ) !== 0 &&
        url.indexOf( 'http' ) !== 0 &&
        url.indexOf( 'file' ) !== 0
      ) {
        return callback( { cancel: false } )
      }

      log( 2, ' == onBeforeRequest: ' + url.slice( 0, 23 ) )

      const shouldBlock = await ipc.promise( {
        type: 'page:onrequest',
        pageId: page.id,
        details: details
      } )

      log( 2, 'shouldBlock: ' + shouldBlock )

      if ( shouldBlock ) {
        log( 2, ' (x) url blocked: ' + url.slice( 0, 55 ) )
        callback( { cancel: true } ) // block
      } else {
        callback( { cancel: false } ) // let through
      }
    }
  )
}

function attachInitialWillNavigateHandler ( page ) {
  if ( !page.win ) return
  if ( page.win._attachInitialWillNavigateHandler ) return
  page.win._attachInitialWillNavigateHandler = true

  const mainWindow = page.win
  const session = mainWindow.webContents.session

  // attach request handler
  mainWindow.webContents.on(
    'will-navigate',
    async function ( evt, url ) {
      // prevent navigation by default
      evt.preventDefault()

      // but inform page api in case they want to take action
      log( 1, 'will-navigate: ' + url.slice( 0, 45 ) )

      const shouldBlock = await ipc.promise( {
        type: 'page:will-navigate',
        pageId: page.id,
        url: url
      } )

      log( 1, 'will-navigate: shouldBlock: ' + shouldBlock )

      if ( shouldBlock ) {
        log( 1, ' (x) navigation blocked: ' + url.slice( 0, 45 ) )
      } else {
        if ( page.win === mainWindow ) {
          log( 1, ' (o) navigating to: ' + url.slice( 0, 45 ) )
          eleko.evaluate( mainWindow, function ( url ) {
            document.location.href = url
          }, url )
        } else {
          log( 1, ' (-) navigation failed, window changed: ' + url.slice( 0, 45 ) )
        }
      }
    }
  )
}
