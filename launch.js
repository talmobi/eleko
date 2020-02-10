const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )

const jp = require( 'jsonpath' )

const eleko = require( './index.js' )
const functionToString = require( 'function-to-string' )
const { serializeError, deserializeError } = require( 'serialize-error' )

// Module to control application life
const app = electron.app

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

const _consoleLog = console.log
console.log = function ( ...args ) {
  emit( {
    type: 'console.log',
    args: args
  } )
}

process.stdout.write( ' == launched == ' )

process.on( 'uncaughtException', function ( error ) {
  try {
    _consoleLog( 'exited electron app' )
    app.quit()
  } catch ( err ) {
    /* ignore */
  }

  console.log( error )

  process.exit( 1 )
} )

// Keep a global ref of the window object, if you don't, the window
// will be closed automatically when the JavaScript object
// is garbage collected
let mainWindow

let _buffer = ''
process.stdin.on( 'data', function ( chunk ) {
  _buffer += chunk

  if ( mainWindow ) {
    _processBuffer()
  }
} )

function _processBuffer ()
{
  process.stdout.write( ' == _processBuffer == ' )

  const lines = _buffer.split( '\n' )
  _buffer = lines.pop()

  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[ i ]
    handleLine( line )
  }
}

function emit ( json )
{
  if ( typeof json !== 'object') throw new TypeError( 'json must be of type object' )
  const jsonString = JSON.stringify( json )
  process.stdout.write( jsonString + '\n' )
}

async function handleLine ( line )
{
  _consoleLog( ' == handleLine == ' )

  let json
  try {
    json = JSON.parse( line )
  } catch ( err ) {
    _consoleLog( err )
  }

  try {
    const type = json.type
    const query = json.query
    const args = json.args

    _consoleLog( 'id: ' + json.id )
    _consoleLog( 'type: ' + type )

    switch ( type ) {
      case 'eleko:ipc:call':
        const fn = jp.value( mainWindow, query )

        let that = mainWindow
        try {
          that = jp.value( mainWindow, query.split( '.' ).slice( 0, -1 ).join( '.' ) )
        } catch ( err ) {
          /* ignore */
        }

        _consoleLog( query )
        _consoleLog( fn )

        args && _consoleLog( ' == args == ' + args.length )
        args && _consoleLog( args )

        const txArgs = args.map( function ( arg ) {
          return decodeValue( arg )
        } )

        txArgs && _consoleLog( ' == txArgs == ' + txArgs.length )
        txArgs && _consoleLog( txArgs )

        let value = fn.apply(
          that,
          txArgs
        )

        function finish () {
          _consoleLog( ' == finish == ' )

          emit( {
            type: 'call:response',
            id: json.id,
            value: value
          } )
        }

        handlePromise()
        async function handlePromise () {
          if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
            // is a promise
            const promise = value

            promise.then( function ( val ) {
              value = val
              return handlePromise()
            } )

            promise.catch( function ( err ) {
              _consoleLog( 'error: ' + err )
              _consoleLog( err )
              return emit( {
                type: 'call:response',
                id: json.id,
                error: err
              } )
            } )
          } else {
            finish()
          }
        }
        break

      default:
        _consoleLog( 'unknown type: ' + type )
    }
  } catch ( err ) {
    emit( {
      type: 'call:response',
      id: json.id,
      error: serializeError( err )
    } )
  }
}

async function createWindow ()
{
  // Create the browser window
  mainWindow = new BrowserWindow( {
    show: false,
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

  process.stdout.write( ' == window created == ' )

  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

  // process anything in the buffer now that we're ready
  if ( _buffer ) _processBuffer()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
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
  // if ( mainWindow === null ) {
  //   createWindow()
  // }
})

function encodeValue ( value )
{
  const type = typeof value

  let content
  if ( type === 'object' || type === 'boolean' ) {
    content = JSON.stringify( value )
  } else if ( type === 'string' ) {
    content = value
  } else if ( type === 'number' ) {
    content = value
  } else if ( type === 'function' ) {
    content = JSON.stringify(
      functionToString( value )
    )
  }

  return {
    type: type,
    content: content
  }
}

function decodeValue ( pkg )
{
  const type = pkg.type
  const content = pkg.content

  if ( type === 'object' || type === 'boolean' ) {
    return JSON.parse( content )
  } else if ( type === 'string' ) {
    return content
  } else if ( type === 'number' ) {
    return Number( content )
  } else if ( type === 'function' ) {
    const info = JSON.parse( content )
    const f = eval(`
      ;(function () {
        return function ${ info.name || '' } ( ${ info.params.join( ', ' ) } ) {
          ${ info.body }
        }
      })()
    `)

    _consoleLog( ' == funcions == ' )
    _consoleLog( f.toString() )

    return f
  }
}
