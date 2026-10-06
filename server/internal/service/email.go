package service

import "errors"

// ErrEmailDisabled documents that local Inkway does not send account or
// invitation email. Keeping this narrow compatibility type lets unrelated
// handler construction remain stable while those account flows are removed.
var ErrEmailDisabled = errors.New("email delivery is disabled in local Inkway")

type EmailService struct{}

func NewEmailService() *EmailService { return &EmailService{} }

func (*EmailService) SendVerificationCode(string, string) error { return ErrEmailDisabled }
func (*EmailService) SendInvitationEmail(string, string, string, string) error {
	return ErrEmailDisabled
}
