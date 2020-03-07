const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const eeto = require( 'eeto' )

const nozombie = require( 'nozombie' )
const pf = require( 'parse-function' )()

const stdioipc = require( './stdio-ipc.js' )

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

const _pages = {}

const verbosity = (
  _envs.debug ? 10 : Number( _envs.verbose )
)

function log ( level, message ) {
  if ( level > verbosity ) return
  console.log( message )
}

process.on( 'uncaughtException', function ( err ) {
  console.log( err )
  process.exit()
} )
process.on( 'exit', onExit )

function onExit ( err ) {
  if ( onExit.done ) return
  onExit.done = true
  log( 1, 'eleko exited' )
}

const api = eeto()

module.exports = api

api.launch = launch

api.goto = goto
api.waitFor = waitFor
api.evaluate = evaluate
api.setUserAgent = setUserAgent
api.getUserAgent = getUserAgent
api.onrequest = onrequest
api.newPage = newPage

api.getDefaultOptions = getDefaultOptions

const WAITFOR_TIMEOUT_TIME = 1000 * 30 // 30 seconds
const POLL_INTERVAL = 200 // milliseconds
const LAUNCH_TIMEOUT_TIME = 30 * 1000 // 30 seconds

// TODO add software rendering opts
// ref: https://swiftshader.googlesource.com/SwiftShader
// ref: https://github.com/google/swiftshader
const DEFAULT_OPTS = {
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

    // preload: path.join( __dirname, 'electron-preload.js' )
    preload: undefined
  }
}

function getDefaultOptions ()
{
  return Object.assign( {}, DEFAULT_OPTS )
}

function launch ( launchOptions )
{
  const _nz = nozombie()

  return new Promise( function ( browserResolve, browserReject ) {
    // path to electron executable in node context
    const _electron = require( 'electron' )

    if ( typeof _electron !== 'string' ) {
      log( 1, 'not a string' )
      throw new Error(`
        Error: trying to spawn electron inside of an existing electron context.
        Spawn from within a node context instead.
          ex. 'node index.js'
      `)
    }

    const _childProcess = require( 'child_process' )

    const _path = require( 'path' )

    // file to be run with electron
    const filepath = path.join( __dirname, 'electron-main.js' )

    const browser = eeto()
    browser._pages = {}

    const _env = Object.assign( {}, process.env, { launched_with_eleko: true } )
    const spawn = _childProcess.spawn( _electron, [ filepath ], { stdio: 'pipe', shell: false, env: _env } )
    _nz.add( spawn.pid )
    browser.spawn = spawn

    const ipc = stdioipc.create( spawn.stdout, spawn.stdin )
    ipc.emit( 'ready' )
    ipc.on( 'log', function ( log ) {
      if ( browser.silent ) return
      console.log( log )
    } )

    let _heartbeatTimeout = setTimeout( pulseHeartbeat, 0 ) // start heartbeats
    function pulseHeartbeat() {
      const json = { type: 'heartbeat' }
      ipc.send( json )
      _heartbeatTimeout = setTimeout( pulseHeartbeat, 1000 )
    }

    ipc.on( 'promise', function ( p ) {
      log( 2, 'ipc:promise ' + p.data.type )

      const data = p.data

      // console.log( data )

      switch ( data.type ) {
        case 'page:onrequest':
          {
            const pageId = data.pageId
            const details = data.details

            const page = browser._pages[ pageId ]
            if ( page && page.status === 'OK' ) {
              function callback ( err, data ) {
                if ( callback.done ) return
                callback.done = true

                log( 2, 'page:onrequest:callback' )
                if ( err ) return p.reject( err )
                return p.resolve( data )
              }

              if ( page.onrequest ) {
                const req = details
                req.abort = function () {
                  log( 2, 'abort' )
                  callback( undefined, true )
                }
                req.continue = function () {
                 log( 2, 'continue' )
                  callback( undefined, false )
                }

                return page.onrequest( req )
              } else {
                return p.resolve()
              }
            }
          }
          break
      }

      return p.resolve()
    } )

    browser.newPage = function ( options ) {
      return new Promise( async function ( resolve, reject ) {
        const evt = { type: 'newPage', content: options }

        let pageId
        try {
          pageId = await ipc.promise( evt )
        } catch ( err ) {
          return reject( err )
        }
        log( 1, 'pageId: ' + pageId )

        const page = {
          id: pageId,
          queue: [],
          queueInProgress: false,
          _timeouts: [],
          status: 'OK'
        }
        browser._pages[ page.id ] = page

        page._queue_tick = async function page_queue_tick () {
          log( 1, 'page._queue_tick' )
          const queue = page.queue

          if ( !page.queueInProgress && queue.length > 0 ) {
            log( 1, 'queueing next' )
            page.queueInProgress = true

            // get ( and remove ) first item from queue
            const q = queue.shift()

            function done () {
              page.queueInProgress = false
              setTimeout( page._queue_tick, 0 )
            }

            try {
              const r = await ipc.promise( q.evt )
              q.callback( undefined, r )
            } catch ( err ) {
              q.callback( err )
            }

            setTimeout( done, 0 )
          } else {
            log( 1, 'queue already in progress' )
          }
        }

        page.goto = function page_goto ( url ) {
          log( 1, 'api.page.goto' )

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:goto', content: { url: url, id: page.id } }
            const queue = page.queue

            // reset queue ( page.goto reloads current page and
            // resets queue because queued up events most likely
            // won't make sense anymore )
            while ( queue.length > 0 ) {
              const q = queue.shift()
              q.callback( 'error: interrupted by parallel page.goto call' )
            }

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:goto callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.evaluate = function page_evaluate ( fn, ...args ) {
          log( 1, 'api.page.evaluate' )

          const content = {
            pf: pf.parse( fn ),
            args: args,
            id: page.id
          }

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:evaluate', content: content }
            const queue = page.queue

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:evaluate callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.waitFor = function page_waitFor ( query, ...args ) {
          log( 1, 'api.page.waitFor' )

          let opts = {}
          if ( typeof query === 'object' ) {
            opts = query
            query = args[ 0 ]
            args = args.slice( 1 )
          }

          const polling = Number( opts.polling ) || POLL_INTERVAL

          if ( typeof query === 'string' ) {
            function fn ( querySelector ) {
              return !!document.querySelector( querySelector )
            }
            return page.waitFor( opts, fn, query )
          }

          return new Promise( async function ( resolve, reject ) {
            if ( typeof query === 'number' ) {
              const t = setTimeout( resolve, query )
              page._timeouts.push( t )
            } else if ( typeof query === 'function' ) {
              const fn = query
              let _tick_timeout

              log( 1, 'api.page.waitFor args: ' )
              log( 1, args )

              function finish ( err ) {
                if ( finish.done ) return
                finish.done = true

                clearTimeout( _wait_timeout )
                clearTimeout( _tick_timeout  )

                if ( err ) return reject( err )
                resolve()
              }

              const _wait_timeout = setTimeout( function () {
                finish( 'error: waitFor timed out (over ' + WAITFOR_TIMEOUT_TIME + ' ms)' )
              }, WAITFOR_TIMEOUT_TIME )
              page._timeouts.push( _wait_timeout )

              _tick_timeout = setTimeout( tick, 1 ) // start polling
              async function tick () {
                log( 1, 'api.page.waitFor tick' )

                try {
                  const done = await page.evaluate( fn, ...args )
                  if ( done ) return finish()
                } catch ( err ) {
                  return finish( err )
                }

                // wait polling interval and try again
                clearTimeout( _tick_timeout )
                _tick_timeout = setTimeout( tick, polling )
                page._timeouts.push( _tick_timeout )
              }
            } else {
              throw new Error( 'error: unknown page.waitFor arguments' )
            }
          } )
        }

        page.setUserAgent = function page_setUserAgent ( userAgent ) {
          log( 1, 'api.page.setUserAgent' )

          const content = {
            userAgent: userAgent,
            id: page.id
          }

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:setUserAgent', content: content }
            const queue = page.queue

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:setUserAgent callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.getUserAgent = function page_getUserAgent () {
          log( 1, 'api.page.getUserAgent' )

          const content = {
            id: page.id
          }

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:getUserAgent', content: content }
            const queue = page.queue

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:getUserAgent callback' )
                if ( err ) return reject( err )
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        page.on = function page_on ( evt, callback ) {
          log( 1, 'api.page.on' )

          switch ( evt ) {
            case 'request':
              page.onrequest = callback
              return function off () {
                page.onrequest = undefined
              }
              break

            default:
              throw new Error( 'error: unknown page.on evt: ' + evt )
          }
        }

        page.close = function page_close () {
          log( 1, 'api.page.close' )

          return new Promise( async function ( resolve, reject ) {
            const evt = { type: 'page:close', content: { id: page.id } }
            const queue = page.queue

            // reset queue ( because queued up events most likely
            // won't make sense anymore )
            while ( queue.length > 0 ) {
              const q = queue.shift()
              q.callback( 'error: interrupted by parallel page.close call' )
            }

            queue.push( {
              evt: evt,
              callback: function q_callback ( err, data ) {
                if ( q_callback.done ) return
                q_callback.done = true
                log( 1, 'queue page:close callback' )
                if ( err ) return reject( err )
                page.status = 'closed'
                resolve( data )
              }
            } )

            page._queue_tick()
          } )
        }

        resolve( page )
      } )
    }


    browser.close = function browser_close () {
      log( 1, 'api.browser.close' )

      if ( browser._close_promise ) {
        return browser._close_promise
      }

      return browser._close_promise = new Promise ( async function ( resolve, reject ) {
        const _force_kill_timeout = setTimeout( function () {
          // force kill
          _nz.kill()
        }, 1000 * 10 )

        browser._close_callback = function ( err, val ) {
          if ( browser._close_callback.done ) return
          clearTimeout( _force_kill_timeout )
          browser._close_callback.done = true

          if ( err ) return reject( err )
          return resolve( val )
        }

        try {
          const r = await ipc.promise( { type: 'quit' } )
          // should quit and trigger spawn 'close' evt handler
        } catch ( err ) {
          browser._close_callback( err )
        }
      } )
    }

    spawn.on( 'close', function ( code ) {
      clearTimeout( _heartbeatTimeout )
      log( 1, 'electron spawn exited, code: ' + code )
      _nz.kill()

      browser.emit( 'exit', code )
      browser.emit( 'close', code )

      if ( browser._close_callback ) {
        browser._close_callback()
      }
    } )

    browserResolve( browser )
  } )
}

function createWindow ( electron, _options )
{
  if ( typeof electron === 'string' ) {
    throw new Error(`
      Error: trying to launch outide of electron context.
      You need to run with the electron binary instead of node.
        ex. 'electron main.js'
        ex. 'node_modules/.bin/electron main.js'
    `)
  }

  // Module to control application life
  const app = electron.app

  process.on( 'uncaughtException', function ( error ) {
    log( 1, ' === uncaughtException === ' )

    try {
      app.quit()
      log( 1, 'exited electron app' )
    } catch ( err ) {
      /* ignore */
    }

    log( 1, error )

    process.exit( 1 )
  } )

  // Module to create native browser window
  const BrowserWindow = electron.BrowserWindow

  return new Promise( function ( resolve, reject ) {
    let _stage = 'pollReadyState'
    let _done = false
    const _timeout = setTimeout( function () {
      if ( _done ) return
      _done = true
      reject( 'error: timed out launch at ' + _stage + ' stage' )
    }, LAUNCH_TIMEOUT_TIME )

    // can't reall attach app.on( 'ready' ) listener because it
    // might already have been called
    pollReadyState()

    function pollReadyState () {
      if ( _done ) return
      log( 1, 'pollReadyState' )

      if ( app.isReady() ) {
        onReady()
      } else {
        setTimeout( pollReadyState, 33 )
      }
    }

    function onReady () {
      log( 1, 'onReady' )

      _stage = 'onReady new BrowserWindow'
      // Create the browser window
      const opts = Object.assign( getDefaultOptions(), _options || {} )
      let mainWindow = new BrowserWindow( opts )

      const session = mainWindow.webContents.session

      // set user-agent lowest compatible
      session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

      _stage = 'finish'
      finish()
      function finish () {
        log( 1, 'finish' )
        if ( _done ) {
          // we already timed out and yet now the window is ready,
          // should rarely happen
          log( 1, 'warning: launch finished but was timed out earlier (launch timeout too short?)' )
          mainWindow = undefined
          return
        }
        _done = true

        clearTimeout( _timeout )
        resolve( mainWindow )
      }
    }
  } )
}

function setUserAgent ( mainWindow )
{
  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )
}

function getUserAgent ( mainWindow )
{
  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  return session.getUserAgent()
}

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
    throw new Error(
      'query must be a string, number or function\n' +
      'function waitFor( mainWindow[, options], query[, ...args] )'
    )
  }

  let _timeout

  return new Promise ( function ( resolve, reject ) {
    function cleanup () {
      clearTimeout( _timeout )
      reject( 'cleanup' )
    }

    const off = api.once( 'pregoto', function () {
      cleanup()
    } )

    if ( typeof query === 'number' ) {
      _timeout = setTimeout( function () {
        off()
        log( 1, ' === waitFor:done (number) === ' )
        resolve()
      }, query )
      return
    }

    let fnString
    if ( typeof query === 'string' ) {
      fnString = (`
        ;(function () {
          /* console.log( ' === waitFor === ' ) */
          return !!document.querySelector( '${ query }' )
        })()
      `)
    } else {
      if ( typeof query !== 'function' ) {
        throw new Error(
          'query must be a string, number or function\n' +
          'function waitFor( mainWindow[, options], query[, ...args] )'
        )
      }
      fnString = parseFunction( query, args )
    }

    const startTime = Date.now()

    function callback ( result ) {
      log( 1, ' === waitFor:callback === ' )

      if ( result ) {
        log( 1, ' === waitFor:done (function) === ' )
        off() // no need to cleanup anymore
        return resolve()
      }

      const ms = Number( opts.polling ) || POLL_INTERVAL

      _timeout = setTimeout( next, ms )
    }

    next()

    async function next () {
      log( 1, ' === waitFor:next === ' )

      const now = Date.now()
      const delta = ( now - startTime )
      if ( delta > WAITFOR_TIMEOUT_TIME ) {
        return reject( 'error: timed out waitFor' )
      }

      try {
        log( 1, ' === waitFor:executeJavaScript === ' )
        const r = await mainWindow.webContents.executeJavaScript(
          fnString,
          true
        )
        callback( r )
      } catch ( err ) {
        log( 1, ' === waitFor:reject === ' )
        reject( err )
      }
    }
  } )
}

async function newPage ( options ) {
  // inside electro context spawn BrowserWindow wrapper
  // with custom page.goto function that replaces the underlying
  // window
  // TODO 

  options = options || {}

  const electron = require( 'electron' )

  if ( typeof electron === 'string' ) {
    throw new Error(`
      Error: trying to launch outide of electron context.
      You need to run with the electron binary instead of node.
        ex. 'electron main.js'
        ex. 'node_modules/.bin/electron main.js'
    `)
  }

  // Module to control application life
  const app = electron.app

  // Module to create native browser window
  const BrowserWindow = electron.BrowserWindow

  return new Promise( function ( resolve, reject ) {
    let _status = 'pollReadyState'
    let _done = false

    const _timeout = setTimeout( function () {
      if ( _done ) return
      _done = true
      reject( 'error: timed out launch at ' + _status + ' stage' )
    }, LAUNCH_TIMEOUT_TIME )

    // can't attach app.on( 'ready' ) listener because it
    // might already have been called
    pollReadyState()

    function pollReadyState () {
      if ( _done ) return
      log( 1, 'pollReadyState' )

      if ( app.isReady() ) {
        onReady()
      } else {
        setTimeout( pollReadyState, 33 )
      }
    }

    function onReady () {
      log( 1, 'onReady' )

      _status = 'onReady new BrowserWindow'

      // merge options with defaults
      const opts = Object.assign(
        getDefaultOptions(), options || {}
      )

      opts.webPreferences = Object.assign(
        getDefaultOptions(), options.webPreferences || {}
      )

      // Create the browser window
      let mainWindow = new BrowserWindow( opts )

      mainWindow._options = options

      const session = mainWindow.webContents.session

      // set user defined userAgent
      if ( options.userAgent ) {
        session.setUserAgent( options.userAgent )
      } else {
        // set user-agent to lowest compatible by default
        // ( Mozilla/5.0 )
        session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )
      }


      // const cookies = electron.session.defaultSession.cookies
      const cookies = session.cookies

      // https://electronjs.org/docs/api/cookies
      // Query all cookies.
      cookies.get( {}, function ( error, cookies ) {
        // console.log( error, cookies )
      } )

      // Query all cookies associated with a specific url
      cookies.get( { url: 'http://youtube.com' }, function ( error, cookies ) {
        // console.log( error, cookies )
      } )

      // Set a cookie with the given cookie data;
      // may overwrite equivalent cookies if they exist.
      const cookie = { url: 'https://www.youtube.com', name: 'CONSENT', value: 'YES+', domain: '.youtube.com' }
      cookies.set( cookie, function ( error ) {
        if ( error ) console.error( error )
      } )


      _status = 'finish'
      finish()
      async function finish () {
        log( 1, 'newPage:finish' )
        if ( _done ) {
          // we already timed out and yet now the window is ready,
          // should rarely happen
          log( 1, 'warning: launch finished but was timed out earlier (launch timeout too short?)' )
          return
        }
        _done = true

        const page = { win: mainWindow }

        _pages._ids = ( _pages._ids || 1 )
        page.id = _pages._ids++
        page._id = page.id

        // save global reference
        _pages[ page.id ] = page

        // Emitted when the window is closed
        mainWindow.on( 'closed', function () {
          log( 2, 'window closed (page.id: ' + page.id + ')' )
          log( 2, 'window closed (page._id: ' + page._id + ')' )

          // Dereference the window object, usually you would store windows
          // in an array if your app supports multi windows, this is the time
          // when you should delete the corresponding element.
          // But only if the underlying window hasn't been replaced with a new one
          if ( page.win === mainWindow ) {
            log( 1, 'window closed (page.id: ' + page.id + ')' )
            log( 1, 'window closed (page._id: ' + page._id + ')' )
            log( 1, 'deleted page.win (page.id: ' + page.id + ')' )
            delete page.win
          }
        } )

        page.goto = async function page_goto ( url ) {
          // create a new page and replace the underlying window
          // with the new one

          log( 1, ' === page.goto === ' )
          log( 1, 'url: ' + url )

          if ( page._pending_goto_callback ) {
            page._pending_goto_callback( 'error: replaced with newer page.goto call' )
            delete page._reject_pending_goto
          }

          return new Promise( async function ( resolve, reject ) {
            log( 1, ' === page.goto:new Promise === ' )

            function callback ( err ) {
              if ( callback.done ) return
              callback.done = true

              if ( err ) return reject( err )
              resolve()
            }
            page._pending_goto_callback = callback

            const mainWindow = page.win // current window (soon replaced)

            const session = mainWindow.webContents.session
            const userAgent = session.getUserAgent()
            log( 1, ' === page.goto:got userAgent === ' )

            const _onrequest = mainWindow._eleko_onrequest
            if ( _onrequest ) {
              session.webRequest.onBeforeRequest( function ( details, callback ) {
                return callback( { cancel: true } )
              } )
            }
            log( 1, ' === page.goto:onBeforeRequest cancel all === ' )

            const isDevToolsOpen = mainWindow.webContents.isDevToolsOpened()
            log( 1, ' === page.goto:isDevToolsOpen: ' + isDevToolsOpen )

            const isVisible = mainWindow.isVisible()
            log( 1, ' === page.goto:isVisible: ' + isVisible )

            log( 1, ' === page.goto:newPage === ' )
            const _newPage = await newPage( options )

            log( 1, ' === page.goto:destroy === ' )
            mainWindow.destroy() // destroy the old window
            page.win = _newPage.win // use the new window
            page._id = _newPage._id

            log( 1, ' === page.goto:newPage.id: ' + _newPage.id )
            delete _pages[ _newPage.id ] // delete the global ref

            if ( isDevToolsOpen ) {
              page.win.webContents.openDevTools()
            } else {
              page.win.webContents.closeDevTools()
            }
            log( 1, ' === page.goto:set DevTools === ' )

            if ( isVisible ) {
              page.win.show()
              // show dock icon if showing window
              app.dock && app.dock.show && app.dock.show()
            } else {
              page.win.hide()
            }
            log( 1, ' === page.goto:set visibility === ' )

            if ( userAgent ) {
              const session = page.win.webContents.session
              session.setUserAgent( userAgent )
              log( 1, ' === page.goto:set userAgent === ' )
            }

            // transfer request listener over to new window
            if ( _onrequest ) {
              onrequest( page.win, _onrequest )
              log( 1, ' === page.goto:set onrequest === ' )
            }

            log( 1, ' === page.goto:loadURL === ' )
            page.win.webContents.loadURL( url )
            // TODO add timeout?

            page.win.webContents.once( 'dom-ready', function () {
              log( 1, ' === page.goto:dom-ready === ' )
              log( 1, ' === page.goto:done === ' )

              delete page._pending_goto_callback
              callback( undefined )
            } )
          } )
        }

        if ( _envs.debug || _envs.devtools ) {
          mainWindow.webContents.openDevTools()
        }

        if ( options.show ) {
          mainWindow.show()
          // show dock icon if showing window
          app.dock && app.dock.show && app.dock.show()
        }

        await mainWindow.webContents.loadURL( 'about:blank' )

        clearTimeout( _timeout )
        resolve( page )
      }
    }
  } )
}

function goto ( mainWindow, url ) {
  // DEPRECATED: use newPage api with page.goto instead
  // ex: page = await newPage()
  // await page.goto( url )

  return new Promise( function ( resolve, reject ) {
    mainWindow.loadURL( url )

    mainWindow.webContents.once( 'dom-ready', function () {
      log( 1, ' === goto:dom-ready === ' )
      log( 1, ' === goto:done === ' )
      resolve()
    } )
  } )
}

function evaluate ( mainWindow, fn, ...args )
{
  log( 1, ' === evaluate === ' )

  const fnString = parseFunction( fn, args )

  return new Promise( async function ( resolve, reject ) {
    try {
      const r = await mainWindow.webContents.executeJavaScript(
        fnString,
        true
      )
      resolve( r )
    } catch ( err ) {
      reject( err )
    }
  } )
}

function parseFunction ( fn, args )
{
  const fnString = fn.toString()

  args = args || []
  args = args.map( function ( arg ) { return JSON.stringify( arg ) } )

  const wrapped = (`
    ;(${ fnString })(${ args.join( ',' ) });
  `)

  log( 1, ' === parseFunction begin === ' )
  if ( wrapped.length < 100 ) {
    log( 1, wrapped )
  } else {
    log( 1, wrapped.slice( 0, 85 ) + '...' )
  }
  log( 1, ' === parseFunction end === ' )

  return wrapped
}

function onrequest ( mainWindow, listener )
{
  const session = mainWindow.webContents.session
  mainWindow._eleko_onrequest = listener

  // attach request handler
  session.webRequest.onBeforeRequest(
    async function ( details, callback ) {
      const req = details
      const url = details.url

      // special cases to always allow
      if ( url.indexOf( 'devtools' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if ( url.indexOf( 'about:blank' ) === 0 ) {
        return callback( { cancel: false } )
      }
      if (
        url.indexOf( 'http' ) !== 0 &&
        url.indexOf( 'file' ) !== 0
      ) {
        return callback( { cancel: false } )
      }

      const _timeout = setTimeout( function () {
        throw Error(`
            .onrequest -- timed out!
            Did you forget to call req.abort() or req.continue() ?
            You can disable this error by calling req.ignore()
          `)
      }, 3000 )

      req.abort = function () {
        clearTimeout( _timeout )
        return callback( { cancel: true } )
      }
      req.continue = function () {
        clearTimeout( _timeout )
        return callback( { cancel: false } )
      }
      req.ignore = function () {
        clearTimeout( _timeout )
      }

      listener( req )
    }
  )
}
