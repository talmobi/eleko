const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

function parseFunction ( fn, args )
{
  const fnString = fn.toString()

  args = args.map( function ( arg ) { return JSON.stringify( arg ) } )

  const wrapped = (`
    ;(${ fnString })(${ args.join( ',' ) });
  `)

  console.log( wrapped )

  return wrapped
}

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )

  try {
    app.quit()
    console.log( 'exited electron app' )
  } catch ( err ) {
    /* ignore */
  }

  console.log( error )

  process.exit( 1 )
} )

// load adblock plus easylist to block urls related to ads
let easyList
try {
  easyList = fs.readFileSync(
    path.join( __dirname, './easylist.txt' ), 'utf8'
  ).split( /\r?\n\r?/ )
} catch ( err ) {
  console.log( 'failed to load easylist.txt ( try downloading with "npm run download-easylist" )' )
  easyList = []
}
console.log( 'easyList length: ' + easyList.length )

// called in session.webRequest.onBeforeRequest(...) to allow/reject ads
function containsAds ( url )
{
  if ( !easyList ) return false

  url = String( url )

  for ( let i = 0; i < easyList.length; i++ ) {
    const item = easyList[ i ] || ''
    if ( item.length > 3 && url.indexOf( item ) >= 0 ) {
      return true
    }
  }

  return false
}

// Module to control application life
const app = electron.app

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

// Keep a global ref of the window object, if you don't, the widow
// will be closed automatically when the JavaScript object
// is garbage collected
let mainWindow

// Setup IPC ( inter process communication ) between the electron application and your nodejs code
const ipcMain = require( 'electron' ).ipcMain

ipcMain.on( 'set-size', function ( evt, data ) {
  console.log( '[ipcMain]: set-size' )
  console.log( data )

  if ( mainWindow ) {
    mainWindow.setSize( data.width, data.height, 0 )
    // mainWindow.show()
  }
} )

ipcMain.on( 'ready-to-show', function ( evt, data ) {
  console.log( '[ipcMain]: ready-to-show' )
  console.log( data )

  if ( mainWindow ) {
    // mainWindow.setSize( data.width, data.height, 0 )
    // mainWindow.show()
  }
} )

ipcMain.on( 'tick', function ( evt, data ) {
  console.log( '[ipcMain]: tick: ' + data )
} )

ipcMain.on( 'show', function ( evt, data ) {
  console.log( '[ipcMain]: show' )
  console.log( data )

  if ( mainWindow ) {
    mainWindow.show()
  }
} )

ipcMain.on( 'hide', function ( evt, data ) {
  console.log( '[ipcMain]: hide' )
  console.log( data )

  if ( mainWindow ) {
    mainWindow.hide()
  }
} )

ipcMain.on( 'quit', function ( evt, data ) {
  console.log( '[ipcMain]: quit' )
  console.log( data )

  app.quit()
} )

// example data
const _philipGlassHoursVideoId = 'Wkof3nPK--Y'
const pkmnBlueWaveId = 'pFbkURxNKPE' // requires h264
const creedenceId = 'Gu2pVPWGYMQ' // AV1
const _urlTemplate = 'https://www.youtube.com/watch/$videoId'
const _videoId = process.argv.slice( 2 )[ 0 ] || _philipGlassHoursVideoId

function execFunc ( fn )
{
  const fnString = fn.toString()
  return ( '(' + fnString + ')();' )
}

const MAX_TIMEOUT = 1000 * 30 // 30 seconds
const POLL_INTERVAL = 200 // milliseconds

// mainWindow[, options], query[, ...args])
function waitFor ( mainWindow, query, ...args )
{
  let opts = {}
  if ( typeof query === 'object' ) {
    opts = query
    query = args[ 0 ]
    args = args.slice( 1 )
  }

  if ( typeof query === 'object' ) {
    throw new Error(`
query must be a string, number or function
function waitFor( mainWindow[, options], query[, ...args] )
      `)
  }

  return new Promise ( function ( resolve, reject ) {
    if ( typeof query === 'number' ) {
      return setTimeout( resolve, query )
    }

    let fnString
    if ( typeof query === 'string' ) {
      fnString = (`
        ;(function () {
          console.log( ' === waitFor === ' )
          return !!document.querySelector( '${ query }' )
        })()
      `)
    } else {
      if ( typeof query !== 'function' ) {
        throw new Error(`
query must be a string, number or function
function waitFor( mainWindow[, options], query[, ...args] )
      `)
      }
      fnString = parseFunction( query, args )
    }

    const startTime = Date.now()

    function callback ( result ) {
      console.log( ' === callback === ' )

      if ( result ) {
        return resolve()
      }

      const ms = Number( opts.polling ) || POLL_INTERVAL

      setTimeout( next, ms )
    }

    next()

    async function next () {
      console.log( ' === next === ' )

      const now = Date.now()
      const delta = ( now - startTime )
      if ( delta > MAX_TIMEOUT ) {
        return reject( 'timed out' )
      }

      try {
        const p = await mainWindow.webContents.executeJavaScript(
          fnString,
          true
        )
        callback( p )
      } catch ( err ) {
        throw 'error: waitFor query: ' + query
      }
    }
  } )
}

function goto ( mainWindow, url )
{
  console.log( ' === goto === ' )

  return new Promise( async function ( resolve, reject ) {
    try {
      const p = await mainWindow.loadURL( url )
      console.log( ' >> GOTO DONE << ' )
      resolve()
    } catch ( err ) {
      reject( err )
    }
  } )
}

function evaluate ( mainWindow, fn, ...args )
{
  console.log( ' === evaluate === ' )

  const fnString = parseFunction( fn, args )

  return new Promise( async function ( resolve, reject ) {
    const p = await mainWindow.webContents.executeJavaScript(
      fnString,
      true
    )
    resolve( p )
  } )
}

async function createWindow ()
{
  // Create the browser window
  mainWindow = new BrowserWindow( {
    show: true,
    width: 800,
    height: 600,
    webPreferences: {
      autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 2 ],

      // javascript: false,
      images: false,
      webgl: false,

      nodeIntegration: false,
      webviewTag: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join( __dirname, 'preload.js' )
    }
  } )

  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/elekid)' )

  // const cookies = electron.session.defaultSession.cookies
  const cookies = session.cookies

  // https://electronjs.org/docs/api/cookies
  // Query all cookies.
  cookies.get( {}, function ( error, cookies ) {
    // console.log( error, cookies )
  } )

  // Query all cookies associated with a specific url.
  cookies.get( { url: 'http://youtube.com' }, function ( error, cookies ) {
    // console.log( error, cookies )
  } )

  // Set a cookie with the given cookie data;
  // may overwrite equivalent cookies if they exist.
  const cookie = { url: 'https://www.youtube.com', name: 'CONSENT', value: 'YES+', domain: '.youtube.com' }
  cookies.set( cookie, function ( error ) {
    if ( error ) console.error( error )
  } )

  // cancel or do something before requests
  session.webRequest.onBeforeRequest(
    function ( details, callback ) {
      let url = details.url

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
  )

  // mainWindow.webContents.executeJavaScript( 'alert("hello!")')
  // mainWindow.webContents.executeJavaScript( execFunc( 'playVideo' ) )

  mainWindow.on( 'ready-to-show', function () {
    console.log( 'ready-to-show' )
    mainWindow.show()
  } )

  // and load the index.html of the app
  // mainWindow.loadFile(
  // path.join( __dirname, 'index.html' )
  // )

  // await new Promise( r => setTimeout( r, 5000 ) )

  // example load url
  console.log( 'playing video id: ' + _videoId )
  await goto( mainWindow, _urlTemplate.replace( '$videoId', _videoId ) )

  await waitFor( mainWindow, 'video' )

  let duration = await evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )
    video.pause()
    video._play = video.play
    video.play = function () {}
    return video.duration
  } )

  console.log( 'video duration: ' + duration )

  let title = await evaluate( mainWindow, function ( el ) {
    return document[ el ]
  }, 'title' )

  console.log( 'title: ' + title )

  console.log( 'waiting for #primary' )
  await waitFor( mainWindow, '#primary' )
  console.log( ' -> #primary found' )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 5 ) )

  await evaluate( mainWindow, function () {
    const el = document.getElementById( 'primary' )
    el.style.background = 'red'

    const video = document.querySelector( 'video' )
    video._play()
  } )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 10 ) )

  await goto( mainWindow, _urlTemplate.replace( '$videoId', _philipGlassHoursVideoId ) )

  await waitFor( mainWindow, 'video' )

  duration = await evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )
    video.pause()
    video._play = video.play
    video.play = function () {}
    return video.duration
  } )

  console.log( 'video duration: ' + duration )

  title = await evaluate( mainWindow, function ( number, object ) {
    console.log( 'number: ' + number )
    return document[ object.name ]
  }, 888, { name: 'title' } )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 3 ) )

  console.log( 'waiting for #primary' )
  await waitFor( mainWindow, '#primary' )
  console.log( ' -> #primary found' )

  await evaluate( mainWindow, function () {
    const el = document.getElementById( 'primary' )
    el.style.background = 'green'

    const video = document.querySelector( 'video' )
    video._play()
  } )

  // Open the DevTools
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed
  mainWindow.on( 'closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element
    mainWindow = null
  } )
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', function () {
  createWindow()
} )

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  app.quit()
})

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( mainWindow === null ) {
    createWindow()
  }
})
