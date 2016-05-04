Sharing = require '../lib/sharing'
async = require "async"
crypto = require "crypto"
util = require 'util'
log = require('printit')
    prefix: 'sharing'

libToken = require '../lib/token'
utils = require '../helpers/utils'
db = require('../helpers/db_connect_helper').db_connect()

TOKEN_LENGTH = 32


# Randomly generates a token.
generateToken = (length) ->
    return crypto.randomBytes(length).toString('hex')


# Returns the target position in the array
findTargetIndex = (targetArray, target) ->
    i = targetArray.map((t) -> t.recipientUrl).indexOf target.recipientUrl


# Add a shareID field for each doc specified in the sharing rules
addShareIDnDocs = (rules, shareID, callback) ->
    async.eachSeries rules, (rule, cb) ->
        db.get rule.id, (err, doc) ->
            if err?
                cb err
            else
                doc.shareID = shareID
                db.merge rule.id, doc, (err, result) ->
                    cb err
    , (err) ->
        callback err


# Creation of the Sharing document
#
# The structure of a Sharing document is as following.
# Note that the [generated] fields to not need to be indicated
# share {
#   id         -> [generated] the id of the sharing document.
#                 This id will sometimes be refered as the shareID
#   desc       -> [optionnal] a human-readable description of what is shared
#   rules[]    -> a set of rules describing which documents will be shared,
#                 providing their id and their docType
#   targets[]  -> an array containing the users to whom the documents will be
#                 shared. See below for a description of this structure
#   continuous -> [optionnal] boolean saying if the sharing is synchronous
#                 set at false by default
#                 The sync is one-way, from sharer to recipient
#   docType    -> [generated] Automatically set at 'sharing'
# }
#
# The target structure:
# target {
#   recipientUrl -> the url of the recipient's cozy
#   preToken     -> [generated] a token used to authenticate the target's answer
#   token        -> [generated] the token linked to the sharing process,
#                   sent by the recipient
#   repID        -> [generated] the id generated by CouchDB for the replication
# }
module.exports.create = (req, res, next) ->
    share = req.body

    # We need at least a target and a rule to initiate a share
    if utils.hasEmptyField share, ["targets", "rules"]
        err        = new Error "Body is incomplete"
        err.status = 400
        return next err

    # Each rule must have an id and a docType
    if utils.hasIncorrectStructure share.rules, ["id", "docType"]
        err        = new Error "Incorrect rule detected"
        err.status = 400
        return next err

    # Each target must have an url
    if utils.hasIncorrectStructure share.targets, ["recipientUrl"]
        err        = new Error "No url specified"
        err.status = 400
        return next err

    # The docType is fixed
    share.docType = "sharing"

    # Generate a preToken for each target
    for target in share.targets
        target.preToken = generateToken TOKEN_LENGTH

    # save the share document in the database
    db.save share, (err, res) ->
        if err?
            next err
        else
            share.shareID = res._id
            req.share = share
            next()


# Delete an existing sharing, identified by its id
module.exports.delete = (req, res, next) ->
    # check if the information is available
    if not req.params?.id?
        err = new Error "Bad request"
        err.status = 400
        next err
    else
        shareID = req.params.id

        # Get all the targets in the sharing document
        db.get shareID, (err, doc) ->
            if err?
                next err
            else
                share =
                    shareID: shareID
                    targets: doc.targets

                # remove the sharing document in the database
                db.remove shareID, (err, res) ->
                    return next err if err?
                    req.share = share
                    next()


# Send a sharing request for each target defined in the share object
# It will be viewed as a notification on the targets side
# Params must contains :
#   shareID    -> the id of the sharing process
#   rules[]    -> the set of rules specifying which documents are shared,
#                 with their docTypes.
#   targets[]  -> the targets to notify. Each target must have an url
#                 and a preToken
module.exports.sendSharingRequests = (req, res, next) ->

    share = req.share

    # Notify each target
    async.eachSeries share.targets, (target, callback) ->
        request =
            recipientUrl: target.recipientUrl
            preToken    : target.preToken
            shareID     : share.shareID
            rules       : share.rules
            desc        : share.desc

        log.info "Send sharing request to : #{request.recipientUrl}"

        Sharing.notifyRecipient "services/sharing/request", request, callback

    , (err) ->
        if err?
            next err
        else
            res.status(200).send success: true


# Send a sharing request for each target defined in the share object
# It will be viewed as a notification on the targets side
# Params must contains :# share {
#   shareID    -> the id of the sharing process
#   targets[]  -> the targets to notify. Each target must have an url
#                 and a token
module.exports.sendDeleteNotifications = (req, res, next) ->
    share = req.share

    # Notify each target
    async.eachSeries share.targets, (target, callback) ->
        notif =
            recipientUrl: target.recipientUrl
            token       : target.token or target.preToken
            shareID     : share.shareID
            desc        : "The sharing #{share.shareID} has been deleted"

        log.info "Send sharing cancel notification to : #{notif.recipientUrl}"

        Sharing.notifyRecipient "services/sharing/cancel", notif, callback

    , (err) ->
        if err?
            next err
        else
            res.status(200).send success: true


# Create access if the sharing answer is yes, remove the Sharing doc otherwise.
#
# The access will grant permissions to the sharer, only on the documents
# specified in the sharing request.
# The shareID is then used as a login and a token is generated.
#
# Params must contains :
#   id           -> the id of the Sharing document, created when the sharing
#                   request was received
#   shareID      -> the id of the Sharing document created by the sharer.
#                   This will be used as the sharer's login
#   accepted     -> boolean specifying if the share was accepted or not
#   preToken     -> the token sent by the sharer to authenticate the receiver
#   recipientUrl -> the url of the recipient's cozy
#   sharerUrl    -> the url of the sharer's cozy
#   rules        -> the set of rules specifying which documents are shared,
#                   with their docTypes.
module.exports.handleRecipientAnswer = (req, res, next) ->

    share = req.body

    # A correct answer must have the following attributes
    if utils.hasEmptyField share, ["id", "shareID", "preToken", "accepted",\
                                   "recipientUrl", "sharerUrl", "rules"]
        err = new Error "Bad request: body is incomplete"
        err.status = 400
        return next err

    # Each rule must have an id and a docType
    if utils.hasIncorrectStructure share.rules, ["id", "docType"]
        err = new Error "Bad request: incorrect rule detected"
        err.status = 400
        return next err

    # Create an access if the sharing is accepted
    if share.accepted
        access =
            login   : share.shareID
            password: generateToken TOKEN_LENGTH
            id      : share.id
            rules   : share.rules

        libToken.addAccess access, (err, doc) ->
            return next err if err?

            share.token = access.password
            req.share = share
            return next()

        # TODO : enforce the docType protection with the couchDB's document
        # update validation

    # Delete the Sharing doc if the sharing is refused
    else
        db.remove share.id, (err, res) ->
            return next err if err?
            req.share = share
            next()


# Send the answer to the emitter of the sharing request
#
# Params must contain:
#   shareID      -> the id of the Sharing document generated by the sharer
#   recipientUrl -> the url of the recipient's cozy
#   accepted     -> boolean specifying if the share was accepted or not
#   preToken     -> the token sent by the sharer to authenticate the receiver
#   token        -> the token generated by the receiver if the request was
#                   accepted
#   sharerUrl    -> the url of the sharer's cozy
module.exports.sendAnswer = (req, res, next) ->
    share = req.share

    answer =
        shareID     : share.shareID
        sharerUrl   : share.sharerUrl
        recipientUrl: share.recipientUrl
        accepted    : share.accepted
        preToken    : share.preToken
        token       : share.token

    log.info "Send sharing answer to : #{answer.sharerUrl}"

    Sharing.notifySharer "services/sharing/answer", answer,
    (err, result, body) ->
        if err?
            next err
        else
            res.status(200).send success: true


# Process the answer given by a target regarding the sharing request
# previously sent.
#
# Params must contain:
#   shareID      -> the id of the sharing request
#   recipientUrl -> the url of the recipient's cozy
#   accepted     -> boolean specifying if the share was accepted or not
#   preToken     -> the token sent by the sharer to authenticate the receiver
#   token        -> the token generated by the target, if accepted
module.exports.validateTarget = (req, res, next) ->

    answer = req.body

    # Check the structure of the answer
    if utils.hasEmptyField answer, ["shareID", "recipientUrl", "accepted",\
                                    "preToken", "token"]
        err = new Error "Bad request: body is incomplete"
        err.status = 400
        return next err

    # Get the Sharing document thanks to its id
    db.get answer.shareID, (err, doc) ->
        return next err if err?

        # Get the answering target
        target = doc.targets.filter (t)-> t.recipientUrl is answer.recipientUrl
        target = target[0]

        unless target?
            err = new Error "#{answer.recipientUrl} not found for this sharing"
            err.status = 404
            return next err

        # The answer cannot be sent more than once
        if target.token?
            err = new Error "The answer for this sharing has already been given"
            err.status = 403
            return next err

        # Check if the preToken is correct
        if not target.preToken? or target.preToken isnt answer.preToken
            err = new Error "Unauthorized"
            err.status = 401
            return next err

        # The target has accepted the sharing : save the token
        if answer.accepted
            log.info "Sharing #{answer.shareID} accepted by
                #{target.recipientUrl}"

            target.token = answer.token
            delete target.preToken
        # The target has refused the sharing : remove the target
        else
            log.info "Sharing #{answer.shareID} denied by
                #{target.recipientUrl}"
            i = findTargetIndex doc.targets, target
            doc.targets.splice i, 1

        # Update the Sharing doc
        db.merge doc._id, doc, (err, result) ->
            return next err if err?

            # Add the shareID for each shared document
            addShareIDnDocs doc.rules, doc._id, (err) ->
                return next err if err?

                # Params structure for the replication
                share =
                    target : target
                    doc    : doc

                req.share = share
                next()


# Replicate documents to the target url

# Params must contain:
#   doc        -> the Sharing document
#   target     -> contains the url and the token of the target
module.exports.replicate = (req, res, next) ->
    share = req.share

    # Replicate only if the target has accepted, i.e. gave a token
    if share.target.token?
        doc = share.doc
        target = share.target

        # Retrieve all the docIDs
        docIDs = (rule.id for rule in doc.rules)
        replicate =
            id          : doc._id
            target      : target
            docIDs      : docIDs
            continuous  : doc.continuous

        Sharing.replicateDocs replicate, (err, repID) ->
            if err?
                next err
            # The repID is needed if continuous
            else if replicate.continuous and not repID?
                err = new Error "Replication error"
                err.status = 500
                next err
            else
                log.info "Data successfully sent to #{target.recipientUrl}"

                # Update the target with the repID if the sharing is continuous
                if replicate.continuous
                    i = findTargetIndex doc.targets, target
                    doc.targets[i].repID = repID

                    db.merge doc._id, doc, (err, result) ->
                        return next err if err?

                        res.status(200).send success: true
                else
                    res.status(200).send success: true

    else
        res.status(200).send success: true


# Stop current replications for each specified target
# Params must contain:
#   targets[]  -> Each target must have an url,  a repID and a token
module.exports.stopReplications = (req, res, next) ->
    share = req.share

    # Cancel the replication for all the targets
    async.eachSeries share.targets, (target, cb) ->
        if target.repID?
            Sharing.cancelReplication target.repID, (err) ->
                cb err
        else
            cb()
    , (err) ->
        next err

